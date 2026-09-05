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
        fs.writeFileSync(dbPath, JSON.stringify(inviteData, null, 2), 'utf8');
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

    inviteData[userId].count = inviteData[userId].invitedUsers.length;
    return inviteData[userId];
}

// =====================================================
// QUEST ACCESS ROLE
// =====================================================

function getQuestAccessRole(guild) {
    return guild.roles.cache.find(role => role.name === QUEST_ACCESS_ROLE);
}

// =====================================================
// UPDATE QUEST ACCESS
// =====================================================

async function updateQuestAccess(member) {
    if (!member) return;

    const role = getQuestAccessRole(member.guild);
    if (!role) {
        console.error(`❌ "${QUEST_ACCESS_ROLE}" role was not found in ${member.guild.name}`);
        return;
    }

    const userData = inviteData[member.id];
    const count = userData ? userData.count : 0;

    try {
        if (count >= REQUIRED_INVITES) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role, `Reached ${REQUIRED_INVITES}+ valid invites`);
                console.log(`✅ ${member.user.tag} received Quest Access (${count} invites)`);
            }
            return;
        }

        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role, `Invite count below ${REQUIRED_INVITES}`);
            console.log(`🔒 Quest Access removed from ${member.user.tag} (${count} invites)`);
        }
    } catch (error) {
        console.error(`❌ Failed to update Quest Access for ${member.user.tag}:`, error.message);
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
                cache.set(invite.code, invite.uses ?? 0);
            }

            invitesCache.set(guild.id, cache);
            console.log(`✅ Invite cache loaded: ${guild.name}`);
        } catch (error) {
            console.error(`❌ Failed to cache invites for ${guild.name}:`, error.message);
        }
    }
}

// =====================================================
// FIND USED INVITE
// =====================================================

async function findUsedInvite(guild) {
    const oldCache = invitesCache.get(guild.id) || new Map();
    let newInvites;

    try {
        newInvites = await guild.invites.fetch();
    } catch (error) {
        console.error(`❌ Failed to fetch invites for ${guild.name}:`, error.message);
        return null;
    }

    let usedInvite = null;

    for (const invite of newInvites.values()) {
        const oldUses = oldCache.get(invite.code) ?? 0;
        const newUses = invite.uses ?? 0;

        if (newUses > oldUses) {
            usedInvite = invite;
            break;
        }
    }

    const newCache = new Map();
    for (const invite of newInvites.values()) {
        newCache.set(invite.code, invite.uses ?? 0);
    }
    invitesCache.set(guild.id, newCache);

    return usedInvite;
}

// =====================================================
// MEMBER JOIN
// =====================================================

export async function handleInviteJoin(member) {
    if (!member || member.user.bot) return;

    const guild = member.guild;

    try {
        const usedInvite = await findUsedInvite(guild);
        if (!usedInvite || !usedInvite.inviter) return;

        const inviter = usedInvite.inviter;
        if (inviter.id === member.id) return;

        const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) return;

        const inviterData = getUserData(inviter.id);

        if (inviterData.invitedUsers.includes(member.id)) return;

        const lastLeft = inviterData.leaveHistory[member.id] || 0;
        const cooldown = REJOIN_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

        if (lastLeft && Date.now() - lastLeft < cooldown) return;

        inviterData.invitedUsers.push(member.id);
        inviterData.count = inviterData.invitedUsers.length;
        delete inviterData.leaveHistory[member.id];

        saveDB();

        console.log(`✅ Valid invite: ${inviter.tag} → ${member.user.tag} (${inviterData.count} total)`);

        const inviterMember = await guild.members.fetch(inviter.id).catch(() => null);
        if (inviterMember) {
            await updateQuestAccess(inviterMember);
            if (inviterData.count >= REQUIRED_INVITES) {
                try {
                    await inviterMember.send(
                        `🎉 **Quest Access Unlocked!**\n\n` +
                        `You now have **${inviterData.count} valid invites**.\n` +
                        `🔓 **Quest Access** has been given to you!`
                    );
                } catch {}
            }
        }
    } catch (error) {
        console.error('❌ Error tracking invite join:', error);
    }
}

// =====================================================
// MEMBER LEAVE
// =====================================================

export async function handleInviteLeave(member) {
    if (!member || member.user.bot) return;

    const guild = member.guild;

    try {
        try {
            const invites = await guild.invites.fetch();
            const newCache = new Map();
            for (const invite of invites.values()) {
                newCache.set(invite.code, invite.uses ?? 0);
            }
            invitesCache.set(guild.id, newCache);
        } catch {}

        for (const inviterId of Object.keys(inviteData)) {
            const data = inviteData[inviterId];
            if (!data || !Array.isArray(data.invitedUsers)) continue;

            const index = data.invitedUsers.indexOf(member.id);
            if (index === -1) continue;

            const oldCount = data.invitedUsers.length;
            data.invitedUsers.splice(index, 1);
            data.count = data.invitedUsers.length;

            if (!data.leaveHistory) data.leaveHistory = {};
            data.leaveHistory[member.id] = Date.now();

            saveDB();

            const inviterMember = await guild.members.fetch(inviterId).catch(() => null);
            if (inviterMember) {
                await updateQuestAccess(inviterMember);

                if (oldCount >= REQUIRED_INVITES && data.count < REQUIRED_INVITES) {
                    try {
                        await inviterMember.send(
                            `⚠️ **Quest Access Locked**\n\n` +
                            `One of your invited members left.\n` +
                            `📊 Current Invites: **${data.count}/${REQUIRED_INVITES}**`
                        );
                    } catch {}
                }
            }
            break;
        }
    } catch (error) {
        console.error('❌ Error handling member leave:', error);
    }
}

// =====================================================
// COMMAND ACCESS
// =====================================================

export async function checkCommandAccess(user, member) {
    const OWNER_ID = process.env.OWNER_ID || '';

    if (OWNER_ID && user.id === OWNER_ID) return { allowed: true };
    if (member.permissions.has('Administrator')) return { allowed: true };

    const isBooster = member.premiumSince !== null;
    const customBoostRole = member.guild.roles.cache.find(r => r.name.toLowerCase().includes('boost'));
    if (isBooster || (customBoostRole && member.roles.cache.has(customBoostRole.id))) {
        return { allowed: true };
    }

    const userData = inviteData[user.id];
    const currentCount = userData ? userData.count : 0;
    const targetRole = getQuestAccessRole(member.guild);

    if (currentCount >= REQUIRED_INVITES) {
        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole, `Has ${currentCount} valid invites`).catch(() => {});
        }
        return { allowed: true };
    }

    if (targetRole && member.roles.cache.has(targetRole.id)) {
        await member.roles.remove(targetRole, `Only ${currentCount} valid invites`).catch(() => {});
    }

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
