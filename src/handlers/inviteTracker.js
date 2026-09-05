import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./invitesData.json');

let inviteData = {};
try {
    if (fs.existsSync(dbPath)) {
        inviteData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
} catch (err) {
    console.error("Error loading invites database:", err);
}

function saveDB() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(inviteData, null, 2));
    } catch (err) {
        console.error("Error saving invites database:", err);
    }
}

const invitesCache = new Map();

// Cache guild invites when bot starts
export async function cacheGuildInvites(client) {
    client.guilds.cache.forEach(async (guild) => {
        try {
            const firstGuildInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(firstGuildInvites.map((invite) => [invite.code, invite.uses])));
        } catch (err) {
            console.error(`Failed to fetch invites for guild ${guild.name}:`, err);
        }
    });
}

// Handle member join & track real invites safely
export async function handleInviteJoin(member) {
    if (!member || member.user.bot) return;

    const guild = member.guild;
    const cachedInvites = invitesCache.get(guild.id);
    if (!cachedInvites) return;

    try {
        const newInvites = await guild.invites.fetch();
        let usedInvite = null;

        for (const [code, invite] of newInvites) {
            const cachedUses = cachedInvites.get(code) || 0;
            if (invite.uses > cachedUses) {
                usedInvite = invite;
                break;
            }
        }

        invitesCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));

        if (usedInvite && usedInvite.inviter) {
            const inviter = usedInvite.inviter;

            if (inviter.id === member.user.id) return;

            const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            if (accountAgeDays < 7) return;

            if (!inviteData[inviter.id]) {
                inviteData[inviter.id] = { count: 0, invitedUsers: [], leaveHistory: {} };
            }
            if (!inviteData[inviter.id].leaveHistory) {
                inviteData[inviter.id].leaveHistory = {};
            }

            const now = Date.now();
            const fourteenDaysInMs = 14 * 24 * 60 * 60 * 1000;
            const lastLeftTime = inviteData[inviter.id].leaveHistory[member.id] || 0;

            const isRecentRejoin = (now - lastLeftTime) < fourteenDaysInMs;
            const isAlreadyInvited = inviteData[inviter.id].invitedUsers.includes(member.id);

            if (isAlreadyInvited || isRecentRejoin) return; 

            inviteData[inviter.id].invitedUsers.push(member.id);
            inviteData[inviter.id].count = inviteData[inviter.id].invitedUsers.length;
            saveDB();

            const currentCount = inviteData[inviter.id].count;
            const targetRole = guild.roles.cache.find(r => r.name === 'Quest Access');

            if (currentCount >= 2 && targetRole) {
                const inviterMember = await guild.members.fetch(inviter.id).catch(() => null);
                if (inviterMember && !inviterMember.roles.cache.has(targetRole.id)) {
                    await inviterMember.roles.add(targetRole).catch(() => {});
                    try {
                        await inviterMember.send(`🎉 Congratulations! You have completed 2 valid invites and your Quest Access has been unlocked.`);
                    } catch {}
                }
            }
        }
    } catch (err) {
        console.error("Error tracking invite join:", err);
    }
}

// Handle member leave safely with accurate verification
export async function handleInviteLeave(member) {
    if (!member || member.user.bot) return;
    const guild = member.guild;

    try {
        const newInvites = await guild.invites.fetch();
        invitesCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) {
        console.error(`Failed to update invites cache on leave:`, err);
    }

    for (const inviterId in inviteData) {
        const data = inviteData[inviterId];
        
        if (data && Array.isArray(data.invitedUsers)) {
            const index = data.invitedUsers.indexOf(member.id);
            if (index !== -1) {
                data.invitedUsers.splice(index, 1);
                data.count = data.invitedUsers.length;
                
                if (!data.leaveHistory) data.leaveHistory = {};
                data.leaveHistory[member.id] = Date.now();

                saveDB();

                const targetRole = guild.roles.cache.find(r => r.name === 'Quest Access');
                if (targetRole) {
                    const inviterMember = await guild.members.fetch(inviterId).catch(() => null);
                    
                    if (inviterMember && data.count < 2) {
                        if (inviterMember.roles.cache.has(targetRole.id)) {
                            await inviterMember.roles.remove(targetRole).catch(() => {});
                            try {
                                await inviterMember.send(`⚠️ One of your invited members left the server. Your active invite count dropped below 2, so your Quest Access has been locked.`);
                            } catch {}
                        }
                    }
                }
                break;
            }
        }
    }
}

// Check command access & auto-correct role if count is valid
export async function checkCommandAccess(user, member) {
    const OWNER_ID = process.env.OWNER_ID || '';

    if (user.id === OWNER_ID || member.permissions.has('Administrator')) {
        return { allowed: true };
    }

    const isBooster = member.premiumSince !== null || member.roles.premiumSubscriberRole;
    const customBoostRole = member.guild.roles.cache.find(r => r.name.toLowerCase().includes('boost'));
    const hasCustomBoostRole = customBoostRole && member.roles.cache.has(customBoostRole.id);

    const targetRole = member.guild.roles.cache.find(r => r.name === 'Quest Access');

    if (isBooster || hasCustomBoostRole) {
        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole).catch(() => {});
        }
        return { allowed: true };
    }

    const currentCount = inviteData[user.id]?.count || 0;

    // AUTO-CORRECTION FIX: Agar database count 2 ya usse zyada hai, toh role turant wapas mil jayega
    if (currentCount >= 2) {
        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole).catch(() => {});
        }
        return { allowed: true };
    } else {
        if (targetRole && member.roles.cache.has(targetRole.id)) {
            await member.roles.remove(targetRole).catch(() => {});
        }
    }

    const progressText = `${Math.min(currentCount, 2)}/2`;

    return { 
        allowed: false, 
        message: `❌ **Access Denied**\n\n` +
                 `You need **Quest Access** to run quest commands on this server.\n\n` +
                 `📊 **Your Invites Progress:** \`${progressText} invites completed\`\n\n` +
                 `✨ **How to get access instantly:**\n` +
                 `• Invite **2 friends** to the server\n` +
                 `• **Boost the Server**` 
    };
}
