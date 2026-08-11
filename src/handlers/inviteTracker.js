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

            // Fake ID / New account filter (3 din se kam purane account count nahi honge)
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
                        await inviterMember.send(`🎉 Congratulations! You have completed 2 valid invites and unlocked quest commands.`);
                    } catch {}
                }
            }
        }
    } catch (err) {
        console.error("Error tracking invite join:", err);
    }
}

export function checkCommandAccess(user, member, REQUIRED_ROLE_ID) {
    const OWNER_ID = process.env.OWNER_ID || '';

    // Owner aur Administrator ke liye direct bypass
    if (user.id === OWNER_ID || member.permissions.has('Administrator')) {
        return { allowed: true };
    }

    // Role check
    if (member.roles.cache.has(REQUIRED_ROLE_ID)) {
        return { allowed: true };
    }

    return { 
        allowed: false, 
        message: `❌ Pehle aapko **2 invites** pure karne honge, tabhi aap quest commands use kar payenge! (Fake IDs aur rejoins count nahi hote).` 
    };
}

