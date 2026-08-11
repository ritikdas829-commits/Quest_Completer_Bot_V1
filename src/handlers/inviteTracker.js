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

export async function handleInviteJoin(member, REQUIRED_ROLE_ID) {
    if (member.user.bot) return;

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

            // Filter out fake or new accounts (accounts younger than 3 days)
            const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            if (accountAgeDays < 3) return;

            const currentCount = userInvitesStore.get(inviter.id) || 0;
            const updatedCount = currentCount + 1;
            userInvitesStore.set(inviter.id, updatedCount);

            if (updatedCount >= 2) {
                const targetRole = guild.roles.cache.get(REQUIRED_ROLE_ID);
                const inviterMember = await guild.members.fetch(inviter.id).catch(() => null);
                
                if (inviterMember && targetRole && !inviterMember.roles.cache.has(targetRole.id)) {
                    await inviterMember.roles.add(targetRole);
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

export async function checkCommandAccess(user, member, REQUIRED_ROLE_ID) {
    const OWNER_ID = process.env.OWNER_ID || '';

    // Direct bypass for Owner and Administrators
    if (user.id === OWNER_ID || member.permissions.has('Administrator')) {
        return { allowed: true };
    }

    // Check if user has the required role
    if (member.roles.cache.has(REQUIRED_ROLE_ID)) {
        return { allowed: true };
    }

    // Real-time fallback: Server ke actual invites check karega agar memory mein count kam ho
    try {
        const invites = await member.guild.invites.fetch();
        let totalUses = 0;
        
        invites.forEach(invite => {
            if (invite.inviter && invite.inviter.id === user.id) {
                totalUses += invite.uses;
            }
        });

        // Agar aapke invites 2 ya usse zyada hain, toh role automatically de do aur access allow karo
        if (totalUses >= 2) {
            const targetRole = member.guild.roles.cache.get(REQUIRED_ROLE_ID);
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
        message: `❌ You need the **Quest Access** role to use quest commands.\n\n📊 **Progress:** \`${progressText}\`\nComplete **2 invites** in the server to get this role automatically!` 
    };
}
