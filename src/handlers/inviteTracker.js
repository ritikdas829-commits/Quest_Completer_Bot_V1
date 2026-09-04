import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./invitesData.json');

const REQUIRED_INVITES = 2;
const MIN_ACCOUNT_AGE_DAYS = 7;
const REJOIN_COOLDOWN_DAYS = 14;
const QUEST_ACCESS_ROLE = 'Quest Access';

// =====================================================
// DATABASE
// =====================================================

let inviteData = {};

try {
    if (fs.existsSync(dbPath)) {
        const rawData = fs.readFileSync(dbPath, 'utf8');

        if (rawData.trim()) {
            inviteData = JSON.parse(rawData);
        }
    }
} catch (error) {
    console.error('❌ Error loading invites database:', error);
    inviteData = {};
}

function saveDB() {
    try {
        fs.writeFileSync(
            dbPath,
            JSON.stringify(inviteData, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('❌ Error saving invites database:', error);
    }
}

// =====================================================
// INVITE CACHE
// =====================================================

const invitesCache = new Map();

// =====================================================
// USER DATA
// =====================================================

function getUserData(userId) {
    if (!inviteData[userId]) {
        inviteData[userId] = {
            count: 0,
            invitedUsers: [],
            leaveHistory: {}
        };
    }

    if (!Array.isArray(inviteData[userId].invitedUsers)) {
        inviteData[userId].invitedUsers = [];
    }

    if (!inviteData[userId].leaveHistory) {
        inviteData[userId].leaveHistory = {};
    }

    // Always keep count synchronized
    inviteData[userId].count =
        inviteData[userId].invitedUsers.length;

    return inviteData[userId];
}

// =====================================================
// QUEST ACCESS ROLE
// =====================================================

function getQuestAccessRole(guild) {
    return guild.roles.cache.find(
        role => role.name === QUEST_ACCESS_ROLE
    );
}

// =====================================================
// UPDATE QUEST ACCESS
//
// 0 = REMOVE
// 1 = REMOVE
// 2+ = GIVE
// =====================================================

async function updateQuestAccess(member) {
    if (!member) return;

    const role = getQuestAccessRole(member.guild);

    if (!role) {
        console.error(
            `❌ "${QUEST_ACCESS_ROLE}" role was not found in ${member.guild.name}`
        );
        return;
    }

    const count =
        inviteData[member.id]?.count || 0;

    try {
        // =============================================
        // 2 OR MORE = GIVE ROLE
        // =============================================

        if (count >= REQUIRED_INVITES) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(
                    role,
                    `Reached ${REQUIRED_INVITES}+ valid invites`
                );

                console.log(
                    `✅ ${member.user.tag} received Quest Access (${count} invites)`
                );
            }

            return;
        }

        // =============================================
        // BELOW 2 = REMOVE ROLE
        // =============================================

        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(
                role,
                `Invite count dropped below ${REQUIRED_INVITES}`
            );

            console.log(
                `🔒 Quest Access removed from ${member.user.tag} (${count} invites)`
            );
        }

    } catch (error) {
        console.error(
            `❌ Failed to update Quest Access for ${member.user.tag}:`,
            error.message
        );
    }
}

// =====================================================
// CACHE GUILD INVITES
// =====================================================

export async function cacheGuildInvites(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            const invites = await guild.invites.fetch();

            const cache = new Map();

            for (const invite of invites.values()) {
                cache.set(
                    invite.code,
                    invite.uses ?? 0
                );
            }

            invitesCache.set(guild.id, cache);

            console.log(
                `✅ Invite cache loaded: ${guild.name}`
            );

        } catch (error) {
            console.error(
                `❌ Failed to cache invites for ${guild.name}:`,
                error.message
            );
        }
    }
}

// =====================================================
// FIND USED INVITE
// =====================================================

async function findUsedInvite(guild) {
    const oldCache =
        invitesCache.get(guild.id) || new Map();

    const newInvites =
        await guild.invites.fetch();

    let usedInvite = null;

    for (const invite of newInvites.values()) {
        const oldUses =
            oldCache.get(invite.code) ?? 0;

        const newUses =
            invite.uses ?? 0;

        if (newUses > oldUses) {
            usedInvite = invite;
            break;
        }
    }

    // Update cache immediately
    const newCache = new Map();

    for (const invite of newInvites.values()) {
        newCache.set(
            invite.code,
            invite.uses ?? 0
        );
    }

    invitesCache.set(guild.id, newCache);

    return usedInvite;
}

// =====================================================
// MEMBER JOIN
// =====================================================

export async function handleInviteJoin(member) {
    if (!member) return;
    if (member.user.bot) return;

    const guild = member.guild;

    try {
        const usedInvite =
            await findUsedInvite(guild);

        // Invite could not be detected
        if (!usedInvite) {
            console.log(
                `⚠️ Could not detect used invite for ${member.user.tag}`
            );
            return;
        }

        // Invite has no inviter
        if (!usedInvite.inviter) {
            console.log(
                `⚠️ Used invite has no inviter: ${usedInvite.code}`
            );
            return;
        }

        const inviter = usedInvite.inviter;

        // =================================================
        // SELF INVITE PROTECTION
        // =================================================

        if (inviter.id === member.id) {
            return;
        }

        // =================================================
        // ACCOUNT AGE CHECK
        // =================================================

        const accountAgeDays =
            (Date.now() - member.user.createdTimestamp) /
            (1000 * 60 * 60 * 24);

        if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
            console.log(
                `⚠️ Invalid invite: ${member.user.tag} account is only ${accountAgeDays.toFixed(1)} days old.`
            );
            return;
        }

        const inviterData =
            getUserData(inviter.id);

        // =================================================
        // DUPLICATE CHECK
        // =================================================

        if (
            inviterData.invitedUsers.includes(
                member.id
            )
        ) {
            console.log(
                `ℹ️ ${member.user.tag} is already counted for ${inviter.tag}`
            );
            return;
        }

        // =================================================
        // REJOIN CHECK
        // =================================================

        const lastLeft =
            inviterData.leaveHistory[member.id] || 0;

        const cooldown =
            REJOIN_COOLDOWN_DAYS *
            24 *
            60 *
            60 *
            1000;

        if (
            lastLeft &&
            Date.now() - lastLeft < cooldown
        ) {
            console.log(
                `⚠️ ${member.user.tag} rejoined too soon. Not counted.`
            );
            return;
        }

        // =================================================
        // ADD VALID INVITE
        // =================================================

        inviterData.invitedUsers.push(
            member.id
        );

        inviterData.count =
            inviterData.invitedUsers.length;

        // Remove old leave record after valid re-count
        delete inviterData.leaveHistory[member.id];

        saveDB();

        console.log(
            `✅ Valid invite: ${inviter.tag} → ${member.user.tag}`
        );

        console.log(
            `📊 ${inviter.tag} now has ${inviterData.count} valid invites`
        );

        // =================================================
        // UPDATE QUEST ACCESS
        // =================================================

        const inviterMember =
            await guild.members
                .fetch(inviter.id)
                .catch(() => null);

        if (!inviterMember) return;

        const oldCount =
            inviterData.count - 1;

        await updateQuestAccess(
            inviterMember
        );

        // =================================================
        // CONGRATULATIONS ONLY WHEN REACHING 2
        // =================================================

        if (
            oldCount < REQUIRED_INVITES &&
            inviterData.count >= REQUIRED_INVITES
        ) {
            try {
                await inviterMember.send(
                    `🎉 **Quest Access Unlocked!**\n\n` +
                    `You now have **${inviterData.count} valid invites**.\n` +
                    `🔓 **Quest Access** has been given to you!`
                );
            } catch {}
        }

    } catch (error) {
        console.error(
            '❌ Error tracking invite join:',
            error
        );
    }
}

// =====================================================
// MEMBER LEAVE
// =====================================================

export async function handleInviteLeave(member) {
    if (!member) return;
    if (member.user.bot) return;

    const guild = member.guild;

    try {
        // =================================================
        // UPDATE INVITE CACHE
        // =================================================

        try {
            const invites =
                await guild.invites.fetch();

            const newCache = new Map();

            for (const invite of invites.values()) {
                newCache.set(
                    invite.code,
                    invite.uses ?? 0
                );
            }

            invitesCache.set(
                guild.id,
                newCache
            );

        } catch (error) {
            console.error(
                '❌ Failed to update invite cache on leave:',
                error.message
            );
        }

        // =================================================
        // FIND THE INVITER
        // =================================================

        for (const inviterId of Object.keys(inviteData)) {
            const data =
                inviteData[inviterId];

            if (!data) continue;

            if (
                !Array.isArray(
                    data.invitedUsers
                )
            ) {
                continue;
            }

            const index =
                data.invitedUsers.indexOf(
                    member.id
                );

            if (index === -1) {
                continue;
            }

            // =================================================
            // REMOVE MEMBER FROM ACTIVE INVITES
            // =================================================

            const oldCount =
                data.invitedUsers.length;

            data.invitedUsers.splice(
                index,
                1
            );

            data.count =
                data.invitedUsers.length;

            // =================================================
            // SAVE LEAVE HISTORY
            // =================================================

            if (!data.leaveHistory) {
                data.leaveHistory = {};
            }

            data.leaveHistory[member.id] =
                Date.now();

            saveDB();

            console.log(
                `📤 ${member.user.tag} left.`
            );

            console.log(
                `📊 Inviter ${inviterId}: ${oldCount} → ${data.count}`
            );

            // =================================================
            // FIND INVITER MEMBER
            // =================================================

            const inviterMember =
                await guild.members
                    .fetch(inviterId)
                    .catch(() => null);

            if (!inviterMember) {
                break;
            }

            // =================================================
            // UPDATE ROLE
            // =================================================

            await updateQuestAccess(
                inviterMember
            );

            // =================================================
            // ACCESS LOST ONLY WHEN 2 → 1
            // =================================================

            if (
                oldCount >= REQUIRED_INVITES &&
                data.count < REQUIRED_INVITES
            ) {
                try {
                    await inviterMember.send(
                        `⚠️ **Quest Access Locked**\n\n` +
                        `One of your valid invited members left the server.\n\n` +
                        `📊 Current Invites: **${data.count}/${REQUIRED_INVITES}**\n\n` +
                        `Invite another valid member to unlock Quest Access again.`
                    );
                } catch {}
            }

            // =================================================
            // STOP AFTER FINDING INVITER
            // =================================================

            break;
        }

    } catch (error) {
        console.error(
            '❌ Error handling member leave:',
            error
        );
    }
}

// =====================================================
// COMMAND ACCESS
// =====================================================

export async function checkCommandAccess(
    user,
    member
) {
    const OWNER_ID =
        process.env.OWNER_ID || '';

    // =================================================
    // OWNER
    // =================================================

    if (
        OWNER_ID &&
        user.id === OWNER_ID
    ) {
        return {
            allowed: true
        };
    }

    // =================================================
    // ADMIN
    // =================================================

    if (
        member.permissions.has('Administrator')
    ) {
        return {
            allowed: true
        };
    }

    // =================================================
    // BOOSTER
    // =================================================

    const isBooster =
        member.premiumSince !== null;

    const customBoostRole =
        member.guild.roles.cache.find(
            role =>
                role.name
                    .toLowerCase()
                    .includes('boost')
        );

    const hasCustomBoostRole =
        customBoostRole &&
        member.roles.cache.has(
            customBoostRole.id
        );

    if (
        isBooster ||
        hasCustomBoostRole
    ) {
        return {
            allowed: true
        };
    }

    // =================================================
    // INVITE COUNT
    // =================================================

    const currentCount =
        inviteData[user.id]?.count || 0;

    const targetRole =
        getQuestAccessRole(
            member.guild
        );

    // =================================================
    // 2+ INVITES = ACCESS
    // =================================================

    if (
        currentCount >= REQUIRED_INVITES
    ) {
        // Auto-correct role if missing
        if (
            targetRole &&
            !member.roles.cache.has(
                targetRole.id
            )
        ) {
            await member.roles
                .add(
                    targetRole,
                    `Has ${currentCount} valid invites`
                )
                .catch(error => {
                    console.error(
                        '❌ Failed to restore Quest Access:',
                        error.message
                    );
                });
        }

        return {
            allowed: true
        };
    }

    // =================================================
    // BELOW 2 = REMOVE ACCESS
    // =================================================

    if (
        targetRole &&
        member.roles.cache.has(
            targetRole.id
        )
    ) {
        await member.roles
            .remove(
                targetRole,
                `Only ${currentCount} valid invites`
            )
            .catch(error => {
                console.error(
                    '❌ Failed to remove Quest Access:',
                    error.message
                );
            });
    }

    // =================================================
    // ACCESS DENIED
    // =================================================

    return {
        allowed: false,

        message:
            `❌ **Access Denied**\n\n` +
            `You need **Quest Access** to run quest commands.\n\n` +
            `📊 **Your Invites:** \`${Math.min(currentCount, REQUIRED_INVITES)}/${REQUIRED_INVITES}\`\n\n` +
            `✨ **How to unlock:**\n` +
            `• Invite **2 valid friends**\n` +
            `• Or **Boost the Server**`
    };
}
