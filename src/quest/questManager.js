import { Quest } from './quest.js';
import { EmbedBuilder } from 'discord.js';

const QuestTaskConfigType = {
    WATCH_VIDEO:           'WATCH_VIDEO',
    PLAY_ON_DESKTOP:       'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP:     'STREAM_ON_DESKTOP',
    PLAY_ACTIVITY:         'PLAY_ACTIVITY',
    WATCH_VIDEO_ON_MOBILE: 'WATCH_VIDEO_ON_MOBILE',
    WATCH_VIDEO_BY_STREAM: 'WATCH_VIDEO_BY_STREAM',
    LEARN_MORE:            'LEARN_MORE',
    WATCH_VIDEO_EMBED:     'WATCH_VIDEO_EMBED',
};

export class QuestManager {
    #quests = new Map();
    client;
    static activeSessionMessage = null;

    constructor(client, quests = []) {
        this.client = client;
        quests.forEach((quest) => this.#quests.set(quest.id, quest));
    }

    static fromResponse(client, response) {
        return new QuestManager(
            client,
            response.quests.map((quest) => Quest.create(quest)),
        );
    }

    [Symbol.iterator]() { return this.#quests.values(); }
    get size() { return this.#quests.size; }
    list() { return Array.from(this.#quests.values()); }
    get(id) { return this.#quests.get(id); }
    upsert(quest) { this.#quests.set(quest.id, quest); }
    remove(id) { return this.#quests.delete(id); }
    clear() { this.#quests.clear(); }
    hasQuest(id) { return this.#quests.has(id); }

    getExpired(date = new Date()) {
        return this.list().filter((q) => q.isExpired(date));
    }
    getCompleted() {
        return this.list().filter((q) => q.isCompleted());
    }
    getClaimable() {
        return this.list().filter((q) => q.isCompleted() && !q.hasClaimedRewards());
    }
    filterQuestsValid() {
        return this.list().filter(
            (q) => !q.isCompleted() && !q.isExpired(),
        );
    }

    async claimRewards(logFn) {
        try {
            const fresh = await this.client.get('/quests/@me');
            for (const q of fresh.quests) {
                const existing = this.#quests.get(q.id);
                if (existing && q.user_status) existing.updateUserStatus(q.user_status);
            }
        } catch {}

        const claimable = this.getClaimable();
        let claimed = 0;
        for (const quest of claimable) {
            try {
                const res = await this.client.post(`/quests/${quest.id}/claim-reward`, {
                    location: 11,
                    is_targeted: false,
                    metadata_raw: null,
                });
                if (res) {
                    claimed++;
                    if (typeof logFn === 'function') logFn(`Claimed reward for quest: ${quest.id}`);
                }
                await this.#timeout(1500);
            } catch (err) {
                continue;
            }
        }
        return claimed;
    }

    async acceptQuest(questId) {
        try {
            const r = await this.client.post(`/quests/${questId}/enroll`, {
                location: 11,
                is_targeted: false,
                metadata_raw: null,
            });
            const quest = this.get(questId);
            if (quest && r) {
                quest.updateUserStatus(extractStatus(r));
            }
            return quest;
        } catch (err) {
            return null;
        }
    }

    #timeout(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async #refreshQuestStatus(quest) {
        try {
            const fresh = await this.client.get('/quests/@me');
            const updated = fresh.quests.find((q) => q.id === quest.id);
            if (updated?.user_status) quest.updateUserStatus(updated.user_status);
        } catch {}
    }

    static async updateSessionBox(channel, questList) {
        if (!channel) return;
        try {
            let description = '';
            let completedCount = 0;
            let totalOrbsEarned = 0;

            questList.forEach((q) => {
                if (q.isCompleted()) completedCount++;
            });

            const totalQuests = questList.length;

            questList.forEach((q) => {
                const qName = q.config.messages.quest_name;
                let rewardText = 'Orbs';
                let orbAmount = 240;

                const rewards = q.config.rewards_config?.rewards;
                if (rewards && rewards.length > 0) {
                    rewardText = rewards[0].messages?.name || 'Orbs';
                    if (rewards[0].orb_quantity) orbAmount = rewards[0].orb_quantity;
                }

                if (q.isCompleted()) {
                    totalOrbsEarned += orbAmount;
                }

                let status = q.isCompleted() ? '🟢 **COMPLETED**' : '⏳ **IN PROGRESS**';

                description += `◆ **${qName}**\n` +
                               `├ 🎁 **Reward:** \`${rewardText}\`\n` +
                               `└ ⚡ **Status:** ${status}\n\n`;
            });

            const headerText = `┏━━━ 🤖 **AI NEURAL • PIPELINE V4** 🤖 ━━━┓\n` +
                               `┃ 📊 **Progress:** \`${completedCount} / ${totalQuests} Done\`\n` +
                               `┃ 💎 **Total Orbs:** \`${totalOrbsEarned} Orbs\`\n` +
                               `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

            const embed = new EmbedBuilder()
                .setColor(completedCount === totalQuests ? '#00FF66' : '#9b59b6')
                .setTitle('🧠 AI Autonomous Quest Execution Dashboard')
                .setDescription(`${headerText}\n\n${description.trim()}`)
                .setFooter({ text: 'InSaNe DyNaStY • Next-Gen AI Auto Runner' })
                .setTimestamp();

            if (QuestManager.activeSessionMessage) {
                await QuestManager.activeSessionMessage.edit({ embeds: [embed] }).catch(async () => {
                    QuestManager.activeSessionMessage = await channel.send({ embeds: [embed] }).catch(() => {});
                });
            } else {
                QuestManager.activeSessionMessage = await channel.send({ embeds: [embed] }).catch(() => {});
            }
        } catch (err) {}
    }

    async doingQuest(quest, channel = null, userId = null, allQuests = []) {
        const questName = quest.config.messages.quest_name;

        if (!quest.isEnrolledQuest()) {
            const enrolled = await this.acceptQuest(quest.id);
            if (!enrolled) return false;
            await this.#timeout(1000);
        }

        const taskConfig = quest.config.task_config ?? quest.config.task_config_v2;
        if (!taskConfig) return false;

        const tasks = taskConfig.tasks ?? {};
        
        // --- FUTURE-PROOF DYNAMIC TASK AUTO-DETECTION ---
        const availableTaskTypes = Object.keys(tasks);
        if (availableTaskTypes.length === 0) return false;

        const taskName = availableTaskTypes[0];
        const task = tasks[taskName];
        const secondsNeeded = task?.target || 30;
        const eventName = task?.event_name ?? task?.type ?? taskName;

        const intervalTimer = setInterval(async () => {
            await this.#refreshQuestStatus(quest);
            if (channel && allQuests.length > 0) {
                QuestManager.updateSessionBox(channel, allQuests);
            }
        }, 20000);

        try {
            // Intelligent check for current and upcoming video/watch quest variations
            if (
                taskName.includes('WATCH') || 
                taskName.includes('VIDEO') || 
                taskName.includes('LEARN') || 
                taskName.includes('EMBED')
            ) {
                const currentTaskId = taskName;
                let secondsDone = readProgress(quest, eventName, taskName);
                const targetSecs = secondsNeeded > 0 ? secondsNeeded : 30;

                while (!quest.isCompleted() && secondsDone <= targetSecs) {
                    try {
                        const payload = {
                            timestamp: secondsDone,
                            task_id: currentTaskId,
                        };
                        if (eventName) payload.event_name = eventName;

                        const res = await this.client.post(`/quests/${quest.id}/video-progress`, payload);
                        if (res) quest.updateUserStatus(extractStatus(res));

                        if (channel) QuestManager.updateSessionBox(channel, allQuests);
                        if (quest.isCompleted()) break;

                        secondsDone += Math.min(10, Math.max(5, Math.floor(targetSecs / 4)));
                        if (secondsDone > targetSecs) secondsDone = targetSecs;
                    } catch (err) {}
                    await this.#timeout(2000);
                }

                try {
                    const finalRes = await this.client.post(`/quests/${quest.id}/video-progress`, {
                        timestamp: targetSecs,
                        task_id: currentTaskId,
                    });
                    if (finalRes) quest.updateUserStatus(extractStatus(finalRes));
                } catch {}

                await this.#refreshQuestStatus(quest);

            } else {
                // Desktop activity, streaming, or any futuristic tasks
                const maxDurationMs = (secondsNeeded + 300) * 1000;
                const startTime = Date.now();

                while (!quest.isCompleted()) {
                    if (Date.now() - startTime > maxDurationMs) break;

                    try {
                        const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: false });
                        if (res) quest.updateUserStatus(extractStatus(res));
                    } catch (err) {
                        await this.#timeout(3000);
                        continue;
                    }

                    if (channel) QuestManager.updateSessionBox(channel, allQuests);

                    const done = readProgress(quest, eventName, taskName);
                    if (done >= secondsNeeded || quest.isCompleted()) break;
                    
                    await this.#timeout(4000);
                }

                try {
                    const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: true });
                    if (res) quest.updateUserStatus(extractStatus(res));
                } catch {}
            }
        } finally {
            clearInterval(intervalTimer);
        }

        if (channel) {
            QuestManager.updateSessionBox(channel, allQuests);
        }

        return true;
    }
}

function extractStatus(res) {
    if (res && typeof res === 'object' && 'user_status' in res && res.user_status) {
        return res.user_status;
    }
    return res;
}

function readProgress(quest, eventName, taskName) {
    const progress = quest.userStatus?.progress;
    if (!progress) return 0;
    
    let val = 0;
    if (eventName && progress[eventName]?.value != null) {
        val = progress[eventName].value;
    } else if (taskName && progress[taskName]?.value != null) {
        val = progress[taskName].value;
    } else {
        const keys = Object.keys(progress);
        for (const k of keys) {
            if (progress[k]?.value != null) {
                val = progress[k].value;
                break;
            }
        }
    }
    return Number(val) || 0;
}

