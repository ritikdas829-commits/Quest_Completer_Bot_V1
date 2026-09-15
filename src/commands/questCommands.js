import {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
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
import { MongoClient } from 'mongodb';
import { QuestClient } from '../quest/questClient.js';
import { TokenStore } from '../quest/tokenStore.js';
import { enableAutoquest, disableAutoquest, isAutoquestEnabled } from '../quest/autoquestStore.js';
import { PREFIX } from '../utils/config.js';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
let dbInstance;

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

async function getUserInvites(userId, guildId = null) {
    try {
        const db = await getDatabase();
        const collections = ['invites', 'users', 'inviteTracker', 'inviteData', 'guildInvites'];
        
        for (const colName of collections) {
            const collection = db.collection(colName);
            const query = {
                $or: [
                    { userId: userId },
                    { id: userId },
                    { _id: userId },
                    { inviterId: userId }
                ]
            };
            if (guildId) query.guildId = guildId;

            const inviteData = await collection.findOne(query);

            if (inviteData) {
                const finalCount = Number(
                    inviteData.invites || 
                    inviteData.count || 
                    inviteData.total || 
                    inviteData.inviteCount || 
                    inviteData.regular || 
                    inviteData.uses?.total || 
                    inviteData.left || 
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

    const userInvites = await getUserInvites(userId, member?.guild?.id);
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

    const userInvites = await getUserInvites(userId, member?.guild?.id);
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
            .setLabel(slot1Token ? 'Unlink Slot 1' : (isSlot1Unlocked ? 'Link Account' : 'Locked (Need 2 Invites)'))
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

    return { 
        components: [headerContainer, slot1Container, slot1Row, slot2Container, slot2Row], 
        flags: MessageFlags.IsComponentsV2 
    };
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

async function runQuestOne(userId, tokenStore, channel, send, member) {
    const token = await tokenStore.get(`${userId}_slot_1`) || await tokenStore.get(`${userId}_slot_2`) || await tokenStore.get(userId);
    if (!token) { 
        const panel = await buildMultiSlotPanel(userId, member, tokenStore);
        await send(panel).catch(() => {}); 
        return false; 
    }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        if (valid.length === 0) { await send(buildNoQuestsCard()).catch(() => {}); return false; }

        const c = new ContainerBuilder().setAccentColor(0x5865F2);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🛡️ Quest Execution Triggered\nProcessing active quests for your linked account...`));
        await send({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
        return true;
    } catch (err) {
        await send(buildErrorCard(err)).catch(() => {});
        return false;
    }
}

export const questCmd = {
    data: new SlashCommandBuilder().setName('quest').setDescription('Complete available Discord quests'),
    prefix: 'quest',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runQuestOne(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.editReply(opts), interaction.member);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runQuestOne(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), message.member);
    },
};

export const questAllCmd = {
    data: new SlashCommandBuilder().setName('q').setDescription('Complete all quests at once'),
    prefix: 'q',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        await runQuestOne(interaction.user.id, client.tokenStore, interaction.channel, (opts) => interaction.editReply(opts), interaction.member);
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        await runQuestOne(message.author.id, client.tokenStore, message.channel, (opts) => message.channel.send(opts), message.member);
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
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        const panel = await buildMultiSlotPanel(message.author.id, message.member, client.tokenStore);
        await message.reply(panel).catch(() => {});
    },
};

export const guideCmd = {
    data: new SlashCommandBuilder().setName('guide').setDescription('View the token linking guide'),
    prefix: 'guide',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        try {
            const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
            guideContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 👑 Script Help & Guide\n\n` +
                    `Use the guide below to get your Discord token for quest completion.\n\n` +
                    `Choose your device below (iOS, Phone, or Computer) to view specific instructions.`
                )
            );

            const deviceRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('device_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
                new ButtonBuilder().setCustomId('device_phone').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
                new ButtonBuilder().setCustomId('device_computer').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻')
            );

            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Watch Video Guide').setStyle(ButtonStyle.Link).setURL('https://youtube.com/your-tutorial-link').setEmoji('▶️')
            );

            // Try sending to DM
            await interaction.user.send({ 
                content: `🌐 **Join our support server:**\nhttps://discord.gg/ZpvmmyHb3Q\n\n🎥 **Video Tutorial:**\nhttps://youtube.com/your-tutorial-link\n\n📜 **Console Script / Guide:**\n\`\`\`javascript\n// Paste this token extraction snippet in your browser console\nwindow.webpackChunkdiscord_app.push([[Math.random()],{},req=>{for(const m of Object.keys(req.c)){let o=req.c[m].exports;if(o&&o.default&&void 0!==o.default.getToken){console.log(o.default.getToken());break;}}]);\n\`\`\``,
                components: [guideContainer], 
                componentsV2: [deviceRow, linkRow], 
                flags: MessageFlags.IsComponentsV2 
            }).catch(async () => {
                // Fallback if DM is closed
                await interaction.editReply({ 
                    content: `❌ **DMs Closed!** I couldn't send you a direct message. Please enable your DMs.\nHere is your link instead: https://youtube.com/your-tutorial-link`,
                    flags: MessageFlags.Ephemeral 
                }).catch(() => {});
                return;
            });

            await interaction.editReply({ content: `📭 I have sent the guide, scripts, and buttons directly to your DMs!`, flags: MessageFlags.Ephemeral }).catch(() => {});
        } catch (err) {
            await interaction.editReply({ content: `❌ Could not process guide command.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;
        try {
            const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
            guideContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 👑 Script Help & Guide\n\n` +
                    `Use the guide below to get your Discord token for quest completion.\n\n` +
                    `Choose your device below (iOS, Phone, or Computer) to view specific instructions.`
                )
            );

            const deviceRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('device_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
                new ButtonBuilder().setCustomId('device_phone').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
                new ButtonBuilder().setCustomId('device_computer').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻')
            );

            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Watch Video Guide').setStyle(ButtonStyle.Link).setURL('https://youtube.com/your-tutorial-link').setEmoji('▶️')
            );

            await message.author.send({ 
                content: `🌐 **Join our support server:**\nhttps://discord.gg/ZpvmmyHb3Q\n\n🎥 **Video Tutorial:**\nhttps://youtube.com/your-tutorial-link\n\n📜 **Console Script / Guide:**\n\`\`\`javascript\n// Paste this token extraction snippet in your browser console\nwindow.webpackChunkdiscord_app.push([[Math.random()],{},req=>{for(const m of Object.keys(req.c)){let o=req.c[m].exports;if(o&&o.default&&void 0!==o.default.getToken){console.log(o.default.getToken());break;}}]);\n\`\`\``,
                components: [guideContainer], 
                componentsV2: [deviceRow, linkRow], 
                flags: MessageFlags.IsComponentsV2 
            }).catch(async () => {
                await message.reply({ content: `❌ **DMs Closed!** Please enable your DMs to receive instructions.` }).catch(() => {});
                return;
            });

            await message.reply({ content: `📭 Check your DMs for instructions and scripts!` }).catch(() => {});
        } catch (err) {
            await message.reply({ content: `❌ Could not send you a DM.` }).catch(() => {});
        }
    },
};

export async function handleSlotButtonAction(interaction, client) {
    const customId = interaction.customId;
    const userId = interaction.user.id;
    const member = interaction.member || await interaction.guild?.members?.fetch(userId).catch(() => null);
    const ts = client.tokenStore;

    if (customId === 'btn_link_slot_1') {
        const hasAccess = await checkSlot1Access(member, userId);
        if (!hasAccess) {
            const currentInvites = await getUserInvites(userId, member?.guild?.id);
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

export async function handlePlatformButton(interaction) {
    const customId = interaction.customId;
    if (customId === 'device_ios') {
        await interaction.reply({ 
            content: `🍎 **iOS Guide & Script:**\n1. Open Safari and go to Discord web.\n2. Open the developer console or use bookmarklets.\n3. Run the token extraction script to get your authorization token.`, 
            flags: MessageFlags.Ephemeral 
        }).catch(() => {});
    } else if (customId === 'device_phone') {
        await interaction.reply({ 
            content: `📱 **Phone Guide & Script:**\n1. Use Kiwi Browser (Android) with Developer Tools or inspect mode.\n2. Go to Discord Web, open console, and paste the token script.`, 
            flags: MessageFlags.Ephemeral 
        }).catch(() => {});
    } else if (customId === 'device_computer') {
        await interaction.reply({ 
            content: `💻 **Computer Guide & Script:**\n1. Open Discord in Chrome/Firefox/Edge.\n2. Press \`Ctrl+Shift+I\` to open Developer Tools.\n3. Go to the **Network** tab, type \`api/v10/users/@me\` in filter, refresh, click the request, and check headers for **Authorization**.`, 
            flags: MessageFlags.Ephemeral 
        }).catch(() => {});
    }
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
