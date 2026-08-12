const invitesCache = new Map();
const userInvitesStore = new Map();

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

export async function handleInviteJoin(member) {
    // If the joined user is a bot, ignore immediately
    if (member.user.bot) return;

    const guild = member.guild;
    const cachedInvites = invitesCache.get(guild.id);
    if (!cachedInvites) return;

    try {
        const newInvites = await guild.invites.fetch();
        let usedInvite = null;

        for (const [code, invite] of newInvites) {
            const cachedUses = cachedInvites.get(code) || 0; // Fixed typo here
            if (invite.uses > cachedUses) {
                usedInvite = invite;
                break;
            }
        }

        // Update the cache with latest invite uses
        invitesCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));

        if (usedInvite && usedInvite.inviter) {
            const inviter = usedInvite.inviter;

            // Prevent self-invites
            if (inviter.id === member.user.id) return;

            // Filter out fake or new accounts (accounts younger than 3 days)
            const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            if (accountAgeDays < 3) {
                console.log(`[Anti-Alt] Ignored fake/new account: ${member.user.tag}`);
                return;
            }

            const currentCount = userInvitesStore.get(inviter.id) || 0;
            const updatedCount = currentCount + 1;
            userInvitesStore.set(inviter.id, updatedCount);

            // Automatically find the 'Quest Access' role in the guild
            const targetRole = guild.roles.cache.find(r => r.name === 'Quest Access');

            if (updatedCount >= 2 && targetRole) {
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

export async function checkCommandAccess(user, member) {
    const OWNER_ID = process.env.OWNER_ID || '';

    // Direct bypass for Owner and Administrators
    if (user.id === OWNER_ID || member.permissions.has('Administrator')) {
        return { allowed: true };
    }

    const targetRole = member.guild.roles.cache.find(r => r.name === 'Quest Access');

    // Real-time server invite check fallback
    try {
        const invites = await member.guild.invites.fetch();
        let totalUses = 0;
        
        invites.forEach(invite => {
            if (invite.inviter && invite.inviter.id === user.id) {
                totalUses += invite.uses;
            }
        });

        if (totalUses >= 2) {
            if (targetRole && !member.roles.cache.has(targetRole.id)) {
                await member.roles.add(targetRole).catch(() => {});
            }
            return { allowed: true };
        }
    } catch (err) {
        console.error("Error checking real invites:", err);
    }

    const currentCount = userInvitesStore.get(user.id) || 0;
    const progressText = `${Math.min(currentCount, 2)}/2 invites completed`;

    return { 
        allowed: false, 
        message: `❌ You must complete **2 invites** to use quest commands!\n\n📊 **Your Progress:** \`${progressText}\`\nComplete 2 valid invites first before you can use any commands.` 
    };
}
