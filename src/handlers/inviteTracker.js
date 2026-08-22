import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./invitesData.json');

// Load or initialize invite database safely
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

// Handle member join & track real invites
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

        // Update cache immediately with new uses
        invitesCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));

        if (usedInvite && usedInvite.inviter) {
            const inviter = usedInvite.inviter;

            // Prevent self-invites
            if (inviter.id === member.user.id) return;

            // Anti-Alt Filter: Ignore accounts younger than 7 days
            const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            if (accountAgeDays < 7) {
                console.log(`[Anti-Alt] Ignored fake/new account: ${member.user.tag}`);
                return;
            }

            if (!inviteData[inviter.id]) {
                inviteData[inviter.id] = { count: 0, invitedUsers: [] };
            }

            // Prevent rejoin exploit
            if (!inviteData[inviter.id].invitedUsers.includes(member.id)) {
                inviteData[inviter.id].invitedUsers.push(member.id);
                inviteData[inviter.id].count += 1;
                saveDB();
            }

            const currentCount = inviteData[inviter.id].count;
            const targetRole = guild.roles.cache.find(r => r.name === 'Quest Access');

            if (currentCount >= 2 && targetRole) {
                const inviterMember = await guild.members.fetch(inviter.id).catch(() => null);
                if (inviterMember && !inviterMember.roles.cache.has(targetRole.id)) {
                    await inviterMember.roles.add(targetRole).catch(err => console.error("Role assign error:", err));
                    try {
                        await inviterMember.send(`🎉 Congratulations! You have completed 2 valid invites and unlocked access to quest commands.`);
                    } catch {}
                }
            }
        }
    } catch (err) {
        console.error("Error tracking invite join:", err);
    }
}

// Handle member leave securely (Won't remove role if total count is still 2 or more)
export async function handleInviteLeave(member) {
    if (!member || member.user.bot) return;
    const guild = member.guild;

    try {
        const newInvites = await guild.invites.fetch();
        invitesCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) {
        console.error(`Failed to update invites cache on leave for guild ${guild.name}:`, err);
    }

    for (const inviterId in inviteData) {
        const data = inviteData[inviterId];
        
        if (data && Array.isArray(data.invitedUsers)) {
            const index = data.invitedUsers.indexOf(member.id);
            if (index !== -1) {
                data.invitedUsers.splice(index, 1);
                data.count = Math.max(0, (data.count || 1) - 1);
                saveDB();

                const targetRole = guild.roles.cache.find(r => r.name === 'Quest Access');
                if (targetRole) {
                    const inviterMember = await guild.members.fetch(inviterId).catch(() => null);
                    
                    // STRICT CHECK: Role tabhi hatega jab count sach mein 2 se kam ho chuka ho (< 2)
                    if (inviterMember && data.count < 2) {
                        if (inviterMember.roles.cache.has(targetRole.id)) {
                            await inviterMember.roles.remove(targetRole).catch(err => console.error("Role remove error:", err));
                            try {
                                await inviterMember.send(`⚠️ One of your invited members left the server. Your invite count dropped below 2, so your Quest Access role has been removed.`);
                            } catch {}
                        }
                    }
                }
                break;
            }
        }
    }
}

// Check command access with role safety check
export async function checkCommandAccess(user, member) {
    const OWNER_ID = process.env.OWNER_ID || '';

    if (user.id === OWNER_ID || member.permissions.has('Administrator')) {
        return { allowed: true };
    }

    const currentCount = inviteData[user.id]?.count || 0;
    const targetRole = member.guild.roles.cache.find(r => r.name === 'Quest Access');

    if (currentCount >= 2) {
        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole).catch(() => {});
        }
        return { allowed: true };
    }

    const progressText = `${Math.min(currentCount, 2)}/2 invites completed`;

    return { 
        allowed: false, 
        message: `❌ **Access Denied**\n\nYou must complete **2 invites** to use quest commands!\n\n📊 **Your Progress:** \`${progressText}\`\n\n🎫 **After completing 2 invites, please open a ticket!**` 
    };
}
