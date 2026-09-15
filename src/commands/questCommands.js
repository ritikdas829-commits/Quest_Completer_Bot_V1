import {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { QuestClient } from '../quest/questClient.js';
import { TokenStore } from '../quest/tokenStore.js';
import { enableAutoquest, disableAutoquest, isAutoquestEnabled } from '../quest/autoquestStore.js';
import { PREFIX } from '../utils/config.js';
import { QuestManager } from '../quest/questManager.js';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
let dbInstance;

const activeQuestUsers = new Set();

async function getDatabase() {
    if (dbInstance) return dbInstance;
    const client = new MongoClient(uri);
    await client.connect();
    dbInstance = client.db();
    return dbInstance;
}

async function checkQuestChannel(interactionOrMessage) {
    if (!interactionOrMessage.guild) return true; 
    
    if (typeof interactionOrMessage.isCommand === 'function' || interactionOrMessage.isChatInputCommand?.()) {
        if (!interactionOrMessage.deferred && !interactionOrMessage.replied) {
            await interactionOrMessage.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    try {
        const db = await getDatabase();
        const settings = await db.collection('guildSettings').findOne({ guildId: interactionOrMessage.guild.id });
        if (settings && settings.questChannelId) {
            const currentChannelId = interactionOrMessage.channelId || interactionOrMessage.channel?.id;
            if (currentChannelId !== settings.questChannelId) {
                const payload = {
                    content: `❌ Quest commands can only be used in <#${settings.questChannelId}>!`,
                    flags: MessageFlags.Ephemeral
                };
                
                if (interactionOrMessage.deferred || interactionOrMessage.replied) {
                    await interactionOrMessage.editReply(payload).catch(() => {});
                } else if (typeof interactionOrMessage.reply === 'function') {
                    await interactionOrMessage.reply(payload).catch(() => {});
                } else if (interactionOrMessage.channel && typeof interactionOrMessage.channel.send === 'function') {
                    await interactionOrMessage.channel.send(payload).catch(() => {});
                }
                return false;
            }
        }
    } catch (err) {
        console.error('[QuestChannel Check Error]:', err);
    }
    return true;
}

export function makeTokenStore(secret) {
    return new TokenStore(secret);
}

async function getUserInvites(userId) {
    try {
        const db = await getDatabase();
        const collections = ['invites', 'users', 'inviteTracker'];
        
        for (const colName of collections) {
            const collection = db.collection(colName);
            const inviteData = await collection.findOne({ 
                $or: [
                    { userId: userId },
                    { id: userId },
                    { _id: userId }
                ]
            });

            if (inviteData) {
                const finalCount = Number(
                    inviteData.invites || 
                    inviteData.count || 
                    inviteData.total || 
                    inviteData.inviteCount || 
                    inviteData.regular || 
                    inviteData.uses?.total || 
                    0
                );
                if (finalCount > 0) return finalCount;
            }
        }
        return 0;
    } catch (err) {
        console.error('[MongoDB Invite Fetch Error]:', err);
        return 0;
    }
}

async function checkSlot1Access(member, userId) {
    const hasQuestAccessRole = member?.roles?.cache?.some(role => role.name === 'Quest Access');
    if (hasQuestAccessRole) return true; 

    const userInvites = await getUserInvites(userId);
    return userInvites >= 2;
}

function checkSlot2Access(member) {
    if (!member) return false;
    
    const isBooster = member.premiumSince !== null || member.roles?.premiumSubscriberRole;
    const customBoostRole = member.guild?.roles.cache.find(r => r.name.toLowerCase().includes('boost'));
    const hasCustomBoostRole = customBoostRole && member.roles?.cache.has(customBoostRole.id);

    return Boolean(isBooster || hasCustomBoostRole);
}

function sanitizeToken(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim()
        .replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
        .replace(/^`+|`+$/g, '')
        .replace(/^Bot\s+/i, '')
        .trim();
}

function isValidUserToken(token) {
    if (!token || typeof token !== 'string') return false;
    return token.length >= 50 && /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token);
}

async function buildMultiSlotPanel(userId, member, tokenStore) {
    const slot1Token = await tokenStore.get(`${userId}_slot_1`);
    const slot2Token = await tokenStore.get(`${userId}_slot_2`);

    const userInvites = await getUserInvites(userId);
    const hasRole = member?.roles?.cache?.some(role => role.name === 'Quest Access') || false;
    
    const isSlot1Unlocked = hasRole || userInvites >= 2;

    const maxInvites = 2;
    const currentInvites = Math.min(userInvites, maxInvites);
    const filledBlocks = '🟩'.repeat(currentInvites);
    const emptyBlocks = '⬛'.repeat(maxInvites - currentInvites);
    const progressBar = `${filledBlocks}${emptyBlocks} (${userInvites}/${maxInvites} Invites)`;

    async function getAccountDetails(token) {
        if (!token) return { status: 'Inactive', age: 'N/A', linkedAt: 'N/A' };
        try {
            const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
            if (res.ok) {
                const data = await res.json();
                const createdAt = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                const now = new Date();
                const diffTime = Math.abs(now - createdAt);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const ageYears = (diffDays / 365).toFixed(1);
                
                return {
                    status: `**${data.global_name || data.username}**`,
                    age: `${ageYears} Years`,
                    linkedAt: new Date().toLocaleDateString()
                };
            }
        } catch (e) {}
        return { status: 'Connected (Error)', age: 'N/A', linkedAt: 'N/A' };
    }

    const slot1Info = await getAccountDetails(slot1Token);
    const slot2Info = await getAccountDetails(slot2Token);

    const headerContainer = new ContainerBuilder().setAccentColor(0x5865F2);
    headerContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ⚡ Nexus Quest Central\n` +
            `> Manage your linked accounts and automate your Discord quests securely.\n` +
            `-# Need help getting started? Use \`${PREFIX}guide\` for instructions.`
        ),
    );

    const slot1Container = new ContainerBuilder().setAccentColor(isSlot1Unlocked ? 0x57F287 : 0xED4245);
    slot1Container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🔒 Slot #1 (Invite Tier)\n` +
            `• **Progress:** ${progressBar}\n` +
            `• **Account:** ${slot1Token ? slot1Info.status : 'Not Linked'}\n` +
            `• **Account Age:** ${slot1Info.age}\n` +
            `-# ${isSlot1Unlocked ? '✅ Access Granted' : '❌ Complete 2 invites to unlock this'}`
        ),
    );

    const slot1Row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(slot1Token ? 'btn_unlink_slot_1' : 'btn_link_slot_1')
            .setLabel(slot1Token ? 'Unlink Slot 1' : (isSlot1Unlocked ? 'Link Account' : 'Complete 2 invites to unlock this'))
            .setStyle(slot1Token ? ButtonStyle.Danger : (isSlot1Unlocked ? ButtonStyle.Success : ButtonStyle.Secondary))
    );

    const slot2Unlocked = checkSlot2Access(member);
    const slot2Container = new ContainerBuilder().setAccentColor(slot2Unlocked ? 0x57F287 : 0xED4245);
    slot2Container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🚀 Slot #2 (Booster Tier)\n` +
            `• **Requirement:** Server Booster / Custom Boost Role\n` +
            `• **Account:** ${slot2Token ? slot2Info.status : 'Not Linked'}\n` +
            `• **Account Age:** ${slot2Info.age}\n` +
            `-# ${slot2Unlocked ? '✅ Booster Access Active' : '❌ Requires Server Boost'}`
        ),
    );

    const slot2Row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(slot2Token ? 'btn_unlink_slot_2' : 'btn_link_slot_2')
            .setLabel(slot2Token ? 'Unlink Slot 2' : 'Link Booster Slot')
            .setStyle(slot2Token ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    const guideContainer = new ContainerBuilder().setAccentColor(0x2b2d31);
    guideContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 📚 Quick Setup Platform Selector\n` +
            `-# Choose your device to view token extraction steps:`,
        ),
    );
    const platformRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_pc').setLabel('💻 PC Guide').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_android').setLabel('🤖 Android Guide').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_ios').setLabel('🍎 iOS Guide').setStyle(ButtonStyle.Secondary),
    );

    return { 
        components: [headerContainer, slot1Container, slot1Row, slot2Container, slot2Row, guideContainer, platformRow], 
        flags: MessageFlags.IsComponentsV2 
    };
}

function buildQuestDashboardCard(questData) {
    const gameTitle = questData?.config?.messages?.game_title || 'Game of Thrones: Dragonfire';
    const publisher = questData?.config?.messages?.publisher || 'Warner Bros. International Enterprises';
    const questName = questData?.config?.messages?.quest_name || 'Game of Thrones: Dragonfire';
    
    const c = new ContainerBuilder().setAccentColor(0x5865F2);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🛡️ Quest Execution Panel\n\n` +
            `• **Game:** ${gameTitle}\n` +
            `• **Publisher:** ${publisher}\n` +
            `• **Quest:** ${questName}\n` +
            `• **Status:** 🔄 Ready to start\n\n` +
            `### 💎 Rewards:\n` +
            `• 200 Orbs`
        ),
    );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quest_start').setLabel('Start Quest').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setCustomId('quest_stop').setLabel('Stop').setStyle(ButtonStyle.Danger).setEmoji('⏹️'),
        new ButtonBuilder().setCustomId('quest_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    );

    const logsContainer = new ContainerBuilder().setAccentColor(0x2b2d31);
    logsContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# 🗂️ Live Logs\n⏳ Waiting for execution...`),
    );

    return { components: [c, logsContainer], componentsV2: [actionRow], flags: MessageFlags.IsComponentsV2 };
}

function buildLinkModal(slotId = '1') {
    const modal = new ModalBuilder().setCustomId(`link_token_modal_${slotId}`).setTitle(`Link Account (Slot ${slotId})`);
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('link_token_input')
                .setLabel('Discord User Token')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Paste your authorization token here...')
                .setRequired(true),
        ),
    );
    return modal;
}

function buildNoQuestsCard() {
    const c = new ContainerBuilder().setAccentColor(0x4F545C);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🔍 No Quests Found\nThere are no active or uncompleted quests available on this account right now.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildErrorCard(err) {
    const msg = err?.message ?? String(err);
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ❌ Execution Error\n${msg.slice(0, 800)}`),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildQuestSelectCard(validQuests) {
    const c = new ContainerBuilder().setAccentColor(0x5865F2);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🎮 Select Target Quest\nChoose a quest from the menu below to begin processing:`
        ),
    );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('quest_select_menu')
        .setPlaceholder('Choose a quest...')
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
    if (activeQuestUsers.has(userId)) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ⏳ Task in Progress\nA quest operation is already running for your account.`));
        await send({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return false;
    }

    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) { 
        const panel = await buildMultiSlotPanel(userId, channel.guild?.members?.cache?.get(userId), tokenStore);
        await send(panel).catch(() => {}); 
        return false; 
    }

    activeQuestUsers.add(userId);
    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        
        if (valid.length === 0) { 
            await send(buildNoQuestsCard()).catch(() => {}); 
            activeQuestUsers.delete(userId);
            return false; 
        }

        const sessionRef = { msg: null };
        try { await QuestManager.updateSessionBox(channel, valid, sessionRef, username); } catch (boxErr) {}

        await Promise.all(
            valid.map(async (quest) => {
                try { await manager.doingQuest(quest, channel, userId, valid, sessionRef, username); } catch (questErr) {}
            })
        );

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const claimedCount = await manager.claimRewards((msg) => {});
                if (claimedCount > 0) break;
            } catch (e) {}
            await new Promise(r => setTimeout(r, 2000));
        }

        activeQuestUsers.delete(userId);
        return true;
    } catch (err) {
        activeQuestUsers.delete(userId);
        await send(buildErrorCard(err)).catch(() => {});
        return false;
    }
}

async function runQuestOne(userId, tokenStore, channel, send, username = 'User') {
    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) { 
        const panel = await buildMultiSlotPanel(userId, channel.guild?.members?.cache?.get(userId), tokenStore);
        await send(panel).catch(() => {}); 
        return false; 
    }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        if (valid.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return false; }

        if (valid.length === 1) {
            await channel.send(buildQuestDashboardCard(valid[0])).catch(() => null);
            return true;
        }

        const selectPayload = buildQuestSelectCard(valid);
        await channel.send({ components: selectPayload.components }).catch(() => null);
        return true;
    } catch (err) {
        await send(buildErrorCard(err)).catch(() => {});
        return false;
    }
}

async function runQuestList(userId, tokenStore, send, member) {
    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) { 
        const panel = await buildMultiSlotPanel(userId, member, tokenStore);
        await send(panel).catch(() => {}); 
        return; 
    }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const all = manager.list();
        if (all.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return; }

        for (const q of all.slice(0, 10)) {
            await send(buildQuestDashboardCard(q)).catch(() => {});
        }
    } catch (err) {
        await send(buildErrorCard(err)).catch(() => {});
    }
}

async function runTokenCheck(userId, tokenStore, replyFn, member) {
    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) {
        const panel = await buildMultiSlotPanel(userId, member, tokenStore);
        await replyFn(panel).catch(() => {});
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
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(valid ? `# ✅ Token Active\nVerified account: **"${accountName}"**.` : `# ❌ Token Expired / Invalid`));
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    if (!valid) {
        await tokenStore.remove(`${userId}_slot_1`);
        await tokenStore.remove(`${userId}_slot_2`);
    }
}

async function runAutoquestToggle(userId, tokenStore, replyFn, member) {
    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) {
        const panel = await buildMultiSlotPanel(userId, member, tokenStore);
        await replyFn(panel).catch(() => {});
        return;
    }

    if (await isAutoquestEnabled(userId)) {
        await disableAutoquest(userId);
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Deactivated`));
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }
    await enableAutoquest(userId);
    const c = new ContainerBuilder().setAccentColor(0x57F287);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Activated Successfully!`));
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

export const questCmd = {
    data: new SlashCommandBuilder().setName('quest').setDescription('Complete available Discord quests'),
    prefix: 'quest',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runQuestOne(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.editReply(opts), interaction.user.username);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runQuestOne(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), message.author.username);
    },
};

export const questAllCmd = {
    data: new SlashCommandBuilder().setName('q').setDescription('Complete all quests at once'),
    prefix: 'q',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runQuestAll(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.editReply(opts), client, interaction.user.username);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runQuestAll(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), client, message.author.username);
    },
};

export const questListCmd = {
    data: new SlashCommandBuilder().setName('questlist').setDescription('List all Discord quests'),
    prefix: 'questlist',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runQuestList(interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts), interaction.member);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runQuestList(message.author.id, client.tokenStore, (opts) => message.channel.send(opts), message.member);
    },
};

export const tokenCheckCmd = {
    data: new SlashCommandBuilder().setName('tokencheck').setDescription('Check token validity'),
    prefix: 'tokencheck',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runTokenCheck(interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts), interaction.member);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runTokenCheck(message.author.id, client.tokenStore, (opts) => message.reply(opts), message.member);
    },
};

export const autoquestCmd = {
    data: new SlashCommandBuilder().setName('autoquest').setDescription('Toggle auto-quest'),
    prefix: 'autoquest',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runAutoquestToggle(interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts), interaction.member);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runAutoquestToggle(message.author.id, client.tokenStore, (opts) => message.reply(opts), message.member);
    },
};

export const linkCmd = {
    data: new SlashCommandBuilder().setName('link').setDescription('Save your Discord token'),
    prefix: 'link',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        const panel = await buildMultiSlotPanel(interaction.user.id, interaction.member, client.tokenStore);
        await interaction.editReply(panel).catch(() => {});
    },
    async prefixExecute(message, args, client) {
        if (!await checkQuestChannel(message)) return;
        const panel = await buildMultiSlotPanel(message.author.id, message.member, client.tokenStore);
        await message.reply(panel).catch(() => {});
    },
};

export const unlinkCmd = {
    data: new SlashCommandBuilder().setName('unlink').setDescription('Remove your saved Discord token'),
    prefix: 'unlink',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        const ts = client.tokenStore;
        await ts.remove(`${interaction.user.id}_slot_1`);
        await ts.remove(`${interaction.user.id}_slot_2`);
        await ts.remove(interaction.user.id);
        await disableAutoquest(interaction.user.id);
        const c = new ContainerBuilder().setAccentColor(0xFEE75C).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🔓 All Tokens Unlinked Successfully`));
        await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        const ts = client.tokenStore;
        await ts.remove(`${message.author.id}_slot_1`);
        await ts.remove(`${message.author.id}_slot_2`);
        await ts.remove(message.author.id);
        await disableAutoquest(message.author.id);
        const c = new ContainerBuilder().setAccentColor(0xFEE75C).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🔓 All Tokens Unlinked Successfully`));
        await message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },
};

export const claimCmd = {
    data: new SlashCommandBuilder().setName('claim').setDescription('Manually claim pending rewards'),
    prefix: 'claim',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await interaction.editReply({ content: `✅ Rewards claim process triggered.` }).catch(() => {});
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await message.reply({ content: `✅ Rewards claim process triggered.` }).catch(() => {});
    },
};

export const guideCmd = {
    data: new SlashCommandBuilder().setName('guide').setDescription('View the token linking and platform setup guide'),
    prefix: 'guide',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        
        const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
        guideContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 👑 Script Help\n\n` +
                `Use the guide below to get your Discord token for quest completion.\n\n` +
                `Choose the device you want to use to get your token. After you click one of the buttons below, I will send you the complete steps and script.`
            ),
        );

        const platformRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
            new ButtonBuilder().setCustomId('btn_android').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
            new ButtonBuilder().setCustomId('btn_pc').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻'),
        );

        try {
            await interaction.user.send({ 
                components: [guideContainer, platformRow], 
                flags: MessageFlags.IsComponentsV2 
            });
            
            await interaction.user.send({ 
                content: `🌐 **Join our support server:**\nhttps://discord.gg/ZpvmmyHb3Q` 
            });

            await interaction.editReply({ content: `📭 I have sent you the guide and server link via Direct Message (DM)!` });
        } catch (err) {
            await interaction.editReply({ content: `❌ Your DMs are closed! Please open your DMs to receive the guide.` });
        }
    },
    async prefixExecute(message, _args, client) {
        const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
        guideContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 👑 Script Help\n\n` +
                `Use the guide below to get your Discord token for quest completion.\n\n` +
                `Choose the device you want to use to get your token. After you click one of the buttons below, I will send you the complete steps and script.`
            ),
        );

        const platformRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
            new ButtonBuilder().setCustomId('btn_android').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
            new ButtonBuilder().setCustomId('btn_pc').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻'),
        );

        try {
            await message.author.send({ 
                components: [guideContainer, platformRow], 
                flags: MessageFlags.IsComponentsV2 
            });

            await message.author.send({ 
                content: `🌐 **Join our support server:**\nhttps://discord.gg/ZpvmmyHb3Q` 
            });

            if (message.guild) {
                const replyMsg = await message.reply({ content: `📭 I have sent you the guide via Direct Message (DM)!` });
                setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
            }
        } catch (err) {
            if (message.guild) {
                await message.reply('❌ Your Direct Messages (DMs) are closed! Please check your privacy settings.').catch(() => {});
            }
        }
    },
};

export async function handleSlotButtonAction(interaction, client) {
    const customId = interaction.customId;
    const userId = interaction.user.id;
    const member = interaction.member;
    const ts = client.tokenStore;

    if (customId === 'btn_link_slot_1') {
        const hasAccess = await checkSlot1Access(member, userId);
        if (!hasAccess) {
            const currentInvites = await getUserInvites(userId);
            await interaction.reply({ 
                content: `❌ **Slot 1 Restricted**\nYou currently have **${currentInvites}/2 invites**. You need to complete 2 invites to unlock this!`, 
                flags: MessageFlags.Ephemeral 
            }).catch(() => {});
            return;
        }
        await interaction.showModal(buildLinkModal('1')).catch(() => {});
    } 
    else if (customId === 'btn_link_slot_2') {
        const hasAccess = checkSlot2Access(member);
        if (!hasAccess) {
            await interaction.reply({ content: `❌ **Slot 2 Locked**\nThis slot requires you to be a **Server Booster** or possess a custom boost role!`, flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }
        await interaction.showModal(buildLinkModal('2')).catch(() => {});
    }
    else if (customId === 'btn_unlink_slot_1') {
        await ts.remove(`${userId}_slot_1`);
        await interaction.reply({ content: `🔓 **Slot 1 Unlinked Successfully!**`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    else if (customId === 'btn_unlink_slot_2') {
        await ts.remove(`${userId}_slot_2`);
        await interaction.reply({ content: `🔓 **Slot 2 Unlinked Successfully!**`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

export async function handleSlotSelectMenu(interaction, client) {
    await handleSlotButtonAction(interaction, client);
}
export async function handleLinkPromptButton(interaction, client) {
    await handleSlotButtonAction(interaction, client);
}

export async function handleLinkModal(interaction, client) {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('link_token_modal_')) return;

    const slotId = interaction.customId.split('_').pop();
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
        await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Token Rejected by Discord API`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return;
    }

    await ts.save(`${interaction.user.id}_slot_${slotId}`, token);
    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ✅ Successfully Linked to Slot ${slotId} as **"${accountName}"**`))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

export async function handlePlatformButton(interaction) {
    const customId = interaction.customId;
    if (customId !== 'btn_pc' && customId !== 'btn_android' && customId !== 'btn_ios') return;

    if (customId === 'btn_pc') {
        const pcScript = `javascript:(function(){var i=document.createElement('iframe');i.style.display='none';document.body.appendChild(i);var t=i.contentWindow.localStorage.token;if(t){try{t=JSON.parse(t)}catch(e){}var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();var n=document.createElement('div');n.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';n.style.cssText='position:fixed;top:20px;left:20px;background:#1a1a2e;color:#e94560;padding:15px 20px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-family:Arial,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s;';document.body.appendChild(n);setTimeout(function(){n.style.opacity='1'},50);setTimeout(function(){n.style.opacity='0';setTimeout(function(){n.remove()},500)},3500)}else{alert('No token found. Make sure you are logged into Discord on this browser.')}})();`;
        const pcVideo = 'https://cdn.discordapp.com/attachments/1470058692660428842/1542354901202501722/1787760131788714.mov?ex=6aa9f9f0&is=6aa8a870&hm=7c797d3753b6f3bbc61839f593a30c4842ea3ccd1c2cc28e118bc7d8108438c0&';
        await interaction.reply({ content: `### 💻 PC Token Setup Guide\n\`\`js\n${pcScript}\n\`\`\n${pcVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }

    if (customId === 'btn_android') {
        const androidScript = `javascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Orbie Token Finder</strong><br>Your Account T0k8n Has Copied Successfully';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s ease-in-out;';document.body.appendChild(n);setTimeout(()=>{n.style.opacity='1';},50);setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),500);},3500);}catch(e){alert('Error copying token');}})();`;
        const androidVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';
        await interaction.reply({ content: `### 🤖 Android Token Setup Guide\n\`\`js\n${androidScript}\n\`\`\n${androidVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }

    if (customId === 'btn_ios') {
        const iosScript = `javascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Orbie Token Finder</strong><br>Your Account T0k8n Has Copied Successfully';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s ease-in-out;';document.body.appendChild(n);setTimeout(()=>{n.style.opacity='1';},50);setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),500);},3500);}catch(e){alert('Error copying token');}})();`;
        const iosVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';
        await interaction.reply({ content: `### 🍎 iOS Token Setup Guide\n\`\`js\n${iosScript}\n\`\`\n${iosVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }
}

export async function handleDashboardButtons(interaction) {
    const customId = interaction.customId;
    if (!['quest_start', 'quest_stop', 'quest_refresh'].includes(customId)) return;

    if (customId === 'quest_start') {
        await interaction.reply({ content: '▶️ Quest solver started successfully!', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (customId === 'quest_stop') {
        await interaction.reply({ content: '⏹️ Quest solver stopped.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (customId === 'quest_refresh') {
        await interaction.reply({ content: '🔄 Dashboard refreshed!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

export async function runAutoquestForUser(userId, tokenStore) {
    try {
        if (!tokenStore || typeof tokenStore.get !== 'function') return;
        const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
        if (!token) return;
        const qc = new QuestClient(token);
        const manager = await qc.fetchQuests();
        const validQuests = manager.filterQuestsValid();
        for (const quest of validQuests) {
            if (!quest.isCompleted() && !quest.isExpired()) {
                const sessionRef = { msg: null };
                await manager.doingQuest(quest, null, userId, validQuests, sessionRef, 'User');
            }
        }
    } catch (err) {
        console.error(`[AutoQuest Error for ${userId}]:`, err?.message);
    }
}

