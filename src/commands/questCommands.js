import {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { QuestClient } from '../quest/questClient.js';
import { TokenStore } from '../quest/tokenStore.js';
import { enableAutoquest, disableAutoquest, isAutoquestEnabled } from '../quest/autoquestStore.js';
import { PREFIX } from '../utils/config.js';
import { QuestManager } from '../quest/questManager.js';

// 📌 Quest Task Config Types Mapping
const QuestTaskConfigType = {
    WATCH_VIDEO:           'WATCH_VIDEO',
    PLAY_ON_DESKTOP:       'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP:     'STREAM_ON_DESKTOP',
    PLAY_ACTIVITY:         'PLAY_ACTIVITY',
    WATCH_VIDEO_ON_MOBILE: 'WATCH_VIDEO_ON_MOBILE',
    WATCH_VIDEO_BY_STREAM: 'WATCH_VIDEO_BY_STREAM',
    LEARN_MORE:            'LEARN_MORE',
    WATCH_VIDEO_EMBED:     'WATCH_VIDEO_EMBED',
    PLAY_ON_XBOX:          'PLAY_ON_XBOX',
    PLAY_ON_PLAYSTATION:   'PLAY_ON_PLAYSTATION',
    ACHIEVEMENT_IN_ACTIVITY: 'ACHIEVEMENT_IN_ACTIVITY',
};

export function makeTokenStore(secret) {
    return new TokenStore(secret);
}

function checkUserAccess(member, interactionOrMessage) {
    if (interactionOrMessage && !interactionOrMessage.guild) return false;
    if (!member) return true;
    
    try {
        if (member.permissions && typeof member.permissions.has === 'function') {
            if (member.permissions.has('Administrator')) return true;
        }
    } catch (e) {}

    const userId = member.id || member.author?.id;
    if (!userId) return false;

    const isBooster = member.premiumSince !== null || member.roles?.premiumSubscriberRole;
    const customBoostRole = member.guild?.roles.cache.find(r => r.name.toLowerCase().includes('boost'));
    const hasCustomBoostRole = customBoostRole && member.roles?.cache.has(customBoostRole.id);
    const targetRole = member.guild?.roles.cache.find(r => r.name === 'Quest Access');

    if (isBooster || hasCustomBoostRole) {
        if (targetRole && member.roles && !member.roles.cache.has(targetRole.id)) {
            member.roles.add(targetRole).catch(() => {});
        }
        return true;
    }

    const dbPath = path.resolve('./invitesData.json');
    if (fs.existsSync(dbPath)) {
        try {
            const inviteData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            const userInvites = inviteData[userId]?.count || 0;
            
            if (member.guild && member.roles) {
                if (userInvites >= 2) {
                    if (targetRole && !member.roles.cache.has(targetRole.id)) {
                        member.roles.add(targetRole).catch(() => {});
                    }
                    return true;
                }
                return member.roles.cache.some(role => role.name === 'Quest Access');
            }
            if (userInvites >= 2) return true;
        } catch (err) {}
    }

    return member.roles?.cache?.some(role => role.name === 'Quest Access') || false;
}

async function sendAccessDenied(interactionOrMessage, isEphemeral = true) {
    const isDM = interactionOrMessage && !interactionOrMessage.guild;
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    
    if (isDM) {
        c.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `❌ **DM Commands Disabled**\n\nYou cannot use quest commands inside Direct Messages (DMs). Please use them inside the server channels!`
            ),
        );
    } else {
        const member = interactionOrMessage.member;
        const userId = member ? member.id : interactionOrMessage.author.id;
        let currentInvites = 0;
        const dbPath = path.resolve('./invitesData.json');
        if (fs.existsSync(dbPath)) {
            try {
                const inviteData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                currentInvites = inviteData[userId]?.count || 0;
            } catch {}
        }

        const progressText = `${Math.min(currentInvites, 2)}/2`;
        c.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `❌ **Access Denied**\n\n` +
                `You need **Quest Access** to run quest commands on this server.\n\n` +
                `📊 **Your Invites Progress:** \`${progressText} invites completed\`\n\n` +
                `✨ **How to get access instantly:**\n` +
                `• Invite **2 friends** to the server *(Automatically unlocks when complete!)*\n` +
                `• **Boost the Server** *(Gives instant access while your boost is active!)*`
            ),
        );
    }

    const payload = { components: [c], flags: MessageFlags.IsComponentsV2 | (isEphemeral && !isDM ? MessageFlags.Ephemeral : 0) };
    try {
        if (interactionOrMessage.reply && typeof interactionOrMessage.reply === 'function') {
            if (!interactionOrMessage.deferred && !interactionOrMessage.replied) {
                await interactionOrMessage.reply(payload).catch(() => {});
                return;
            }
        }
        if (interactionOrMessage.followUp && typeof interactionOrMessage.followUp === 'function') {
            await interactionOrMessage.followUp(payload).catch(() => {});
            return;
        }
        if (interactionOrMessage.channel && typeof interactionOrMessage.channel.send === 'function') {
            await interactionOrMessage.channel.send(payload).catch(() => {});
        }
    } catch {}
}

function sanitizeToken(raw) {
    return raw.trim()
        .replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
        .replace(/^`+|`+$/g, '')
        .replace(/^Bot\s+/i, '')
        .trim();
}

function isValidUserToken(token) {
    return token.length >= 50 && /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token);
}

function buildLinkModal() {
    const modal = new ModalBuilder().setCustomId('link_token_modal').setTitle('Link Your Discord Token');
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('link_token_input')
                .setLabel('Your Discord user token')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Paste your token here...')
                .setRequired(true),
        ),
    );
    return modal;
}

function buildLinkPrompt() {
    const c1 = new ContainerBuilder().setAccentColor(0x5865F2);
    c1.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ⚡ DISCORD SESSION TOKEN REQUIRED\n` +
            `-# Authentication protocol offline. Link your token to unlock quest automation V3.\n\n` +
            `🔑 **Action Required:** Click the button below to open the secure entry portal.`,
        ),
    );
    c1.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c1.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('link_prompt').setLabel('Link Token').setStyle(ButtonStyle.Primary).setEmoji('🔗'),
        ),
    );

    const c2 = new ContainerBuilder().setAccentColor(0x2b2d31);
    c2.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 📖 Setup Guide\n` +
            `-# Select your device platform to view copy instructions:`,
        ),
    );
    c2.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c2.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_pc').setLabel('PC').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_android').setLabel('Android').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary),
        ),
    );

    return { components: [c1, c2], flags: MessageFlags.IsComponentsV2 };
}

function buildNoQuestsCard() {
    const c = new ContainerBuilder().setAccentColor(0x4F545C);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🔍 No Quests Available\nThere are no active, uncompleted quests on your account right now.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildExpiredTokenCard() {
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ❌ Token Expired\nYour saved token was rejected by Discord — it has likely expired.\n\n**Your token has been removed.** Re-link with \`/link\` or \`${PREFIX}link\`.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildErrorCard(err) {
    const msg = err?.message ?? String(err);
    const is401 = msg.includes('401');
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            is401 ? `# ❌ Invalid or Expired Token\nRe-link your token with \`${PREFIX}link\`.` : `# ❌ Error\n${msg.slice(0, 800)}`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildQuestSelectCard(validQuests) {
    const c = new ContainerBuilder().setAccentColor(0x5865F2);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🎮 Select a Quest\n` +
            `Please choose which quest you want to run from the dropdown menu below:`
        ),
    );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('quest_select_menu')
        .setPlaceholder('Choose an available quest...')
        .addOptions(
            validQuests.slice(0, 25).map((q) => {
                const questName = q.config?.messages?.quest_name || 'Unknown Quest';
                const gameTitle = q.config?.messages?.game_title || 'Discord Quest';
                return new StringSelectMenuOptionBuilder()
                    .setLabel(questName.substring(0, 100))
                    .setDescription(gameTitle.substring(0, 100))
                    .setValue(q.id);
            })
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    return { components: [c], componentsV2: [row], flags: MessageFlags.IsComponentsV2 };
}

async function runQuestAll(userId, tokenStore, channel, send, discordClient, username = 'User') {
    const token = tokenStore.get(userId);
    if (!token) { await send(buildLinkPrompt()).catch(() => {}); return false; }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        if (valid.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return false; }

        const sessionRef = { msg: null };
        await QuestManager.updateSessionBox(channel, valid, sessionRef, username);

        await Promise.allSettled(
            valid.map(async (quest) => {
                try {
                    await manager.doingQuest(quest, channel, userId, valid, sessionRef, username);
                } catch (questErr) {
                    console.error(`Quest error for ${quest.id}:`, questErr?.message);
                }
            })
        );

        await manager.claimRewards(console.log).catch(() => 0);

        if (discordClient) {
            for (const quest of valid) {
                if (quest.isCompleted()) {
                    try {
                        const user = await discordClient.users.fetch(userId);
                        const dm = await user.createDM();
                        const c = new ContainerBuilder().setAccentColor(0x57F287);
                        c.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# ✨ Quest Complete (V3)!\n**${quest.config.messages.quest_name}** has been completed successfully.\n✓ Reward collected!`
                            ),
                        );
                        await dm.send({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                    } catch (dmErr) {}
                }
            }
        }

        return true;

    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.includes('401') && tokenStore.has(userId)) {
            tokenStore.remove(userId); disableAutoquest(userId);
            await send(buildExpiredTokenCard()).catch(() => {});
        } else {
            await send(buildErrorCard(err)).catch(() => {});
        }
        return false;
    }
}

async function runQuestOne(userId, tokenStore, channel, send, discordClient, username = 'User') {
    const token = tokenStore.get(userId);
    if (!token) { await send(buildLinkPrompt()).catch(() => {}); return false; }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        if (valid.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return false; }

        if (valid.length === 1) {
            const sessionRef = { msg: null };
            await manager.doingQuest(valid[0], channel, userId, valid, sessionRef, username);
            await manager.claimRewards(console.log).catch(() => 0);
            return true;
        }

        const selectPayload = buildQuestSelectCard(valid);
        await channel.send({
            components: selectPayload.components,
        }).catch(() => null);

        return true;
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.includes('401') && tokenStore.has(userId)) {
            tokenStore.remove(userId); disableAutoquest(userId);
            await send(buildExpiredTokenCard()).catch(() => {});
        } else {
            await send(buildErrorCard(err)).catch(() => {});
        }
        return false;
    }
}

async function runQuestList(userId, tokenStore, send) {
    const token = tokenStore.get(userId);
    if (!token) { await send(buildLinkPrompt()).catch(() => {}); return; }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const all = manager.list();
        if (all.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return; }

        // Using QuestTaskConfigType keys securely here
        const TASK_META = {
            [QuestTaskConfigType.PLAY_ON_DESKTOP]:       { icon: '🖥️', label: 'Play on Desktop' },
            [QuestTaskConfigType.WATCH_VIDEO]:           { icon: '🎬', label: 'Watch Video' },
            [QuestTaskConfigType.STREAM_ON_DESKTOP]:     { icon: '📺', label: 'Stream on Desktop' },
            [QuestTaskConfigType.PLAY_ACTIVITY]:         { icon: '🎮', label: 'Play Activity' },
            [QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE]: { icon: '📱', label: 'Watch Video on Mobile' },
            [QuestTaskConfigType.WATCH_VIDEO_BY_STREAM]: { icon: '📡', label: 'Watch Video by Stream' },
            [QuestTaskConfigType.LEARN_MORE]:            { icon: '💡', label: 'Learn More' },
            [QuestTaskConfigType.WATCH_VIDEO_EMBED]:     { icon: '🎬', label: 'Watch Video Embed' },
            [QuestTaskConfigType.PLAY_ON_XBOX]:          { icon: '🟩', label: 'Play on Xbox' },
            [QuestTaskConfigType.PLAY_ON_PLAYSTATION]:   { icon: '🎮', label: 'Play on PlayStation' },
            [QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY]: { icon: '🏆', label: 'Achievement in Activity' },
        };

        for (const q of all.slice(0, 10)) {
            const cfg = q.config;
            const msgs = cfg.messages;
            const appId = cfg.application.id;
            const thumbUrl = `https://cdn.discordapp.com/app-assets/${appId}/quest-assets/${cfg.assets.game_tile}.png`;
            const expiresEpoch = Math.floor(new Date(cfg.expires_at).getTime() / 1000);
            const daysLeft = Math.max(0, Math.ceil((new Date(cfg.expires_at).getTime() - Date.now()) / 86400000));

            const st = q.isCompleted() ? { color: 0x57F287, icon: '✅', label: 'Completed' }
                : q.isExpired()        ? { color: 0xED4245, icon: '🔴', label: 'Expired' }
                : q.isEnrolledQuest()  ? { color: 0xFEE75C, icon: '⏳', label: 'In Progress' }
                :                        { color: 0x5865F2, icon: '🔵', label: 'Available' };

            const taskLines = Object.entries((cfg.task_config ?? cfg.task_config_v2)?.tasks ?? {}).map(([type, task]) => {
                const meta = TASK_META[type] ?? { icon: '⚙️', label: type };
                let targetSecs = task.target || task.seconds || 0;
                let dur = targetSecs >= 60 ? `  •  ⏱️ **Duration: ${Math.ceil(targetSecs / 60)} min**` : `  •  ⏱️ **Duration: ${targetSecs}s**`;
                return `${meta.icon} ${meta.label}${dur}`;
            });

            const rewardLines = cfg.rewards_config.rewards.map((r) => {
                let line = `**${r.messages.name}**`;
                if (r.orb_quantity) line += `  ✦ *(${r.orb_quantity} Orbs)*`;
                return line;
            });

            const c = new ContainerBuilder().setAccentColor(st.color);
            c.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${st.icon}  ${msgs.quest_name}\n*${msgs.game_title}* •  ${msgs.game_publisher}`,
                        ),
                    )
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl)),
            );
            c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            c.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `📊 **Status:** ${st.label}   📅 **Expires:** <t:${expiresEpoch}:R> *(${daysLeft}d remaining)*\n\n` +
                    `📋 **Task Details & Timer**\n${taskLines.join('\n') || '*Unknown*'}\n\n` +
                    `🎁 **Reward**\n${rewardLines.join('\n') || '*No rewards listed*'}`,
                ),
            );
            await send({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } catch (err) {
        await send(buildErrorCard(err)).catch(() => {});
    }
}

async function runTokenCheck(userId, tokenStore, replyFn) {
    const token = tokenStore.get(userId);
    if (!token) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# No Token Saved\nYou don't have a saved token. Use \`${PREFIX}link\` to save one.`));
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }

    let valid = false, accountName = '';
    try {
        const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
        valid = res.ok;
        if (res.ok) {
            const data = await res.json();
            accountName = data.global_name || data.username || '';
        }
    } catch { valid = false; }

    const c = new ContainerBuilder().setAccentColor(valid ? 0x57F287 : 0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            valid ? `# ✅ Token is Valid (V3)\nLinked as **"${accountName}"**.` : `# ❌ Token Invalid or Expired\nUse \`${PREFIX}unlink\` then \`${PREFIX}link\` to save a fresh token.`,
        ),
    );
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    if (!valid) tokenStore.remove(userId);
}

async function runAutoquestToggle(userId, tokenStore, replyFn) {
    if (isAutoquestEnabled(userId)) {
        disableAutoquest(userId);
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Disabled\nI'll no longer auto-run new quests for you.`));
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }
    if (!tokenStore.has(userId)) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ No Saved Token\nUse \`${PREFIX}link\` first.`));
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }
    enableAutoquest(userId);
    const c = new ContainerBuilder().setAccentColor(0x57F287);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🤖 Auto-Quest Enabled (V3)!\nEvery new Discord quest will be auto-completed for you in the background with timer tracking.`,
        ),
    );
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

export const questCmd = {
    data: new SlashCommandBuilder().setName('quest').setDescription('Complete available Discord quests using interactive selection V3'),
    prefix: 'quest',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.deferReply().catch(() => {});
        await runQuestOne(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.followUp(opts), client, interaction.user.username);
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        await runQuestOne(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), client, message.author.username);
    },
};

export const questAllCmd = {
    data: new SlashCommandBuilder().setName('q').setDescription('Complete all quests at once in a single session box V3'),
    prefix: 'q',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.deferReply().catch(() => {});
        await runQuestAll(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.followUp(opts), client, interaction.user.username);
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        await runQuestAll(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), client, message.author.username);
    },
};

export const questListCmd = {
    data: new SlashCommandBuilder().setName('questlist').setDescription('List all Discord quests and their duration status V3'),
    prefix: 'questlist',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.deferReply().catch(() => {});
        await runQuestList(interaction.user.id, client.tokenStore, (opts) => interaction.followUp(opts));
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        await runQuestList(message.author.id, client.tokenStore, (opts) => message.channel.send(opts));
    },
};

export const tokenCheckCmd = {
    data: new SlashCommandBuilder().setName('tokencheck').setDescription('Check whether your saved Discord token is still valid'),
    prefix: 'tokencheck',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        await runTokenCheck(interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts));
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        await runTokenCheck(message.author.id, client.tokenStore, (opts) => message.reply(opts));
    },
};

export const autoquestCmd = {
    data: new SlashCommandBuilder().setName('autoquest').setDescription('Auto-complete every new quest the moment it drops V3'),
    prefix: 'autoquest',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        await runAutoquestToggle(interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts));
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        await runAutoquestToggle(message.author.id, client.tokenStore, (opts) => message.reply(opts));
    },
};

export const linkCmd = {
    data: new SlashCommandBuilder().setName('link').setDescription('Save your Discord token V3'),
    prefix: 'link',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        await interaction.showModal(buildLinkModal()).catch(() => {});
    },
    async prefixExecute(message, args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        const ts = client.tokenStore;
        const inlineToken = args.join('').trim();
        if (inlineToken) {
            try { await message.delete(); } catch {}
            const token = sanitizeToken(inlineToken);
            const sendDM = async (payload) => {
                const user = await client.users.fetch(message.author.id).catch(() => null);
                const dm = await user?.createDM().catch(() => null);
                await dm?.send(payload).catch(() => {});
            };
            if (!isValidUserToken(token)) {
                await sendDM({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Invalid Token Format`))], flags: MessageFlags.IsComponentsV2 });
                return;
            }
            let accountName = '', verifyOk = false;
            try {
                const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
                verifyOk = res.ok;
                if (res.ok) {
                    const data = await res.json();
                    accountName = data.global_name || data.username || '';
                }
            } catch {}
            if (!verifyOk) return;
            ts.save(message.author.id, token);
            await sendDM({ components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ✅ Token Linked as "${accountName}" (V3)`))], flags: MessageFlags.IsComponentsV2 });
            return;
        }
        await message.reply(buildLinkPrompt()).catch(() => {});
    },
};

export const unlinkCmd = {
    data: new SlashCommandBuilder().setName('unlink').setDescription('Remove your saved Discord token'),
    prefix: 'unlink',
    async execute(interaction, client) {
        if (!checkUserAccess(interaction.member, interaction)) { await sendAccessDenied(interaction); return; }
        const ts = client.tokenStore;
        const removed = ts.remove(interaction.user.id);
        disableAutoquest(interaction.user.id);
        const c = new ContainerBuilder().setAccentColor(removed ? 0xFEE75C : 0x4F545C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(removed ? `# 🔓 Token Unlinked (V3)` : `# No Token Saved`));
        await interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
    },
    async prefixExecute(message, _args, client) {
        if (!checkUserAccess(message.member, message)) { await sendAccessDenied(message, false); return; }
        const ts = client.tokenStore;
        const removed = ts.remove(message.author.id);
        disableAutoquest(message.author.id);
        const c = new ContainerBuilder().setAccentColor(removed ? 0xFEE75C : 0x4F545C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(removed ? `# 🔓 Token Unlinked (V3)` : `# No Token Saved`));
        await message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },
};

export async function handleLinkModal(interaction, client) {
    const ts = client.tokenStore;
    const raw = interaction.fields.getTextInputValue('link_token_input');
    const token = sanitizeToken(raw);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    if (!isValidUserToken(token)) {
        await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Invalid Token Format`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }

    let accountName = '', verifyOk = false;
    try {
        const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
        verifyOk = res.ok;
        if (res.ok) {
            const data = await res.json();
            accountName = data.global_name || data.username || '';
        }
    } catch {}

    if (!verifyOk) {
        await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Token Rejected`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }

    ts.save(interaction.user.id, token);
    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ✅ Token Linked as "${accountName}" (V3)`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

export async function handleLinkPromptButton(interaction) {
    await interaction.showModal(buildLinkModal()).catch(() => {});
}

export async function handlePlatformButton(interaction) {
    const customId = interaction.customId;
    if (customId !== 'btn_pc' && customId !== 'btn_android' && customId !== 'btn_ios') return;

    if (customId === 'btn_pc') {
        const pcScript = `javascript:(function(){var i=document.createElement('iframe');i.style.display='none';document.body.appendChild(i);var t=i.contentWindow.localStorage.token;if(t){try{t=JSON.parse(t)}catch(e){}}var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();var n=document.createElement('div');n.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';n.style.cssText='position:fixed;top:20px;left:20px;background:#1a1a2e;color:#e94560;padding:15px 20px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-family:Arial,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s;';document.body.appendChild(n);setTimeout(function(){n.style.opacity='1';},50);setTimeout(function(){n.style.opacity='0';setTimeout(function(){n.remove();},500);},3500)}else{alert('No token found. Make sure you are logged into Discord on this browser.');}})();`;
        const pcVideo = 'https://cdn.discordapp.com/attachments/1539823157425348758/1540748022399504404/lv_0_20260821085534.mp4';

        await interaction.reply({
            content: `### 📌 How to use (V3)\n\`\`\n${pcScript}\n\`\`\n${pcVideo}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    if (customId === 'btn_android') {
        const androidScript = `javascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s ease-in-out;';document.body.appendChild(n);setTimeout(()=>n.style.opacity='1',50);setTimeout(()=>n.style.opacity='0',3500);setTimeout(()=>n.remove(),4000);}catch(e){alert('Error copying token');}})();`;
        const androidVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';

        await interaction.reply({
            content: `### 📌 How to use (V3)\n\`\`\n${androidScript}\n\`\`\n${androidVideo}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    if (customId === 'btn_ios') {
        const iosScript = `javascript:(function(){try{var i=document.createElement('iframe');document.body.appendChild(i);var t=JSON.parse(i.contentWindow.localStorage.token.replace(/^"(.*)"$/, '$1'));navigator.clipboard.writeText(t).then(function(){var d=document.createElement('div');d.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';Object.assign(d.style,{position:'fixed',top:'10px',left:'10px',background:'#d4edda',color:'#155724',padding:'10px',border:'1px solid #c3e6cb',borderRadius:'5px',zIndex:99999,fontFamily:'sans-serif'});document.body.appendChild(d);setTimeout(()=>d.remove(),3000);});}catch(e){alert('Failed to copy token: '+e);}})();`;
        const iosVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';

        await interaction.reply({
            content: `### 📌 How to use (V3)\n\`\`\n${iosScript}\n\`\`\n${iosVideo}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }
}

export async function runAutoquestForUser(userId, quest, tokenStore, discordClient) {
    const token = tokenStore.get(userId);
    if (!token) { disableAutoquest(userId); return; }

    const { QuestClient: QC } = await import('../quest/questClient.js');
    const { Quest: Q } = await import('../quest/quest.js');
    const qc = new QC(token);
    const logs = [];
    const log = (m) => { console.log(`[AutoQuest V3:${userId}]`, m); logs.push(m); };

    try {
        const manager = await qc.fetchQuests();
        let live = manager.get(quest.id);
        if (!live) {
            live = Q.create({ id: quest.id, config: quest.config, user_status: null, targeted_content: quest.targetedContent, preview: quest.preview });
        }
        if (live.isCompleted() || live.isExpired()) return;

        await manager.doingQuest(live, null, userId, [live]);
        let claimManager = manager;
        try { claimManager = await qc.fetchQuests(); } catch {}
        const claimed = await claimManager.claimRewards(log).catch(() => 0);

        try {
            const user = await discordClient.users.fetch(userId);
            const dm = await user.createDM();
            const c = new ContainerBuilder().setAccentColor(0x57F287);
            c.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🤖 Auto-Quest Complete (V3)!\n**${live.config.messages.quest_name}** has been completed automatically.\n${claimed > 0 ? `🎁 **${claimed}** reward(s) claimed.\n` : ''}`,
                ),
            );
            await dm.send({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch {}
    } catch (err) {
        console.error(`[AutoQuest V3:${userId}] Error:`, err?.message);
    }
}
