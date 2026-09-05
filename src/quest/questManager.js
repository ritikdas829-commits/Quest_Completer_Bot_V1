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
    PLAY_ON_XBOX:          'PLAY_ON_XBOX',
    PLAY_ON_PLAYSTATION:   'PLAY_ON_PLAYSTATION',
    ACHIEVEMENT_IN_ACTIVITY: 'ACHIEVEMENT_IN_ACTIVITY',
};

export class QuestManager {
    #quests = new Map();
    client;

    constructor(client, quests = []) {
        this.client = client;
        quests.forEach((quest) => this.#quests.set(quest.id, quest));
    }

    static fromResponse(client, response) {
        if (response.quest_enrollment_blocked_until !== null) {
            throw new Error(
                `Quest enrollment is blocked until ${response.quest_enrollment_blocked_until}.`,
            );
        }
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
    remove(id) { this.#quests.delete(id); }
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

    async #safeRequest(requestFn, retries = 3, delay = 3000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await requestFn();
            } catch (err) {
                const isRateLimit = err?.status === 429 || err?.response?.status === 429;
                if (i === retries - 1) {
                    throw err;
                }
                const waitTime = isRateLimit ? 5000 : delay;
                await this.#timeout(waitTime);
            }
        }
    }

    async claimRewards(logFn) {
        try {
            const fresh = await this.#safeRequest(() => this.client.get('/quests/@me'));
            if (fresh && fresh.quests) {
                for (const q of fresh.quests) {
                    const existing = this.#quests.get(q.id);
                    if (existing && q.user_status) existing.updateUserStatus(q.user_status);
                }
            }
        } catch {}

        const claimable = this.getClaimable();
        let claimed = 0;
        for (const quest of claimable) {
            try {
                const res = await this.#safeRequest(() => 
                    this.client.post(`/quests/${quest.id}/claim-reward`, {
                        location: 11,
                        is_targeted: false,
                        metadata_raw: null,
                    })
                );
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

    async acceptQuest(questId, isAndroid = false) {
        try {
            const r = await this.#safeRequest(() => 
                this.client.post(`/quests/${questId}/enroll`, {
                    location: isAndroid ? 12 : 11,
                    is_targeted: false,
                    metadata_raw: null,
                })
            );
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
            const fresh = await this.#safeRequest(() => this.client.get('/quests/@me'));
            if (fresh && fresh.quests) {
                const updated = fresh.quests.find((q) => q.id === quest.id);
                if (updated?.user_status) quest.updateUserStatus(updated.user_status);
            }
        } catch {}
    }

    // Quest Completer V3 - Live Dashboard Generator (Fixed to prevent message spam)
    static async updateSessionBox(channel, questList, sessionMessageRef = { msg: null }, userName = 'User') {
        if (!channel) return sessionMessageRef.msg;
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

                const taskConfig = q.config.task_config ?? q.config.task_config_v2;
                const tasks = taskConfig?.tasks ?? {};
                const taskName = Object.keys(tasks)[0];
                const task = tasks[taskName];
                const targetSecs = task?.target || task?.seconds || 30;
                
                const durationFormatted = targetSecs >= 60 ? `${Math.floor(targetSecs / 60)} min` : `${targetSecs}s`;

                const eventName = task?.event_name ?? task?.type ?? taskName;
                const currentProgress = readProgress(q, eventName, taskName);
                
                const percentage = Math.min(100, Math.floor((currentProgress / targetSecs) * 100));
                const filledBlocks = Math.floor(percentage / 10);
                const emptyBlocks = 10 - filledBlocks;
                const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

                let status = q.isCompleted() ? '🟢 **COMPLETED**' : '⏳ **IN PROGRESS**';

                description += `◆ **${qName}**\n` +
                               `├ 🎁 **Reward:** \`${rewardText}\`\n` +
                               `├ ⚡ **Status:** ${status}\n` +
                               `├ ⏱️ **Duration:** \`${durationFormatted}\`\n` +
                               `└ 📈 \`[${progressBar}]\` **${percentage}%**\n\n`;
            });

            const headerText = `┏━━━ 🤖 **AI NEURAL • PIPELINE V3** 🤖 ━━━┓\n` +
                               `┃ 👤 **User:** \`${userName}\`\n` +
                               `┃ 📊 **Progress:** \`${completedCount} / ${totalQuests} Done\`\n` +
                               `┃ 💎 **Total Orbs:** \`${totalOrbsEarned} Orbs\`\n` +
                               `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

            const embed = new EmbedBuilder()
                .setColor(completedCount === totalQuests ? '#00FF66' : '#9b59b6')
                .setTitle('🧠 AI Autonomous Quest Execution Dashboard (V3)')
                .setDescription(`${headerText}\n\n${description.trim()}`)
                .setFooter({ text: 'InSaNe DyNaStY • Next-Gen AI Auto Runner V3' })
                .setTimestamp();

            // FIX: Ensure it updates the existing message instead of sending new ones
            if (sessionMessageRef.msg) {
                try {
                    sessionMessageRef.msg = await sessionMessageRef.msg.edit({ embeds: [embed] });
                } catch (err) {
                    sessionMessageRef.msg = await channel.send({ embeds: [embed] }).catch(() => null);
                }
            } else {
                sessionMessageRef.msg = await channel.send({ embeds: [embed] }).catch(() => null);
            }
            return sessionMessageRef.msg;
        } catch (err) {
            return sessionMessageRef.msg;
        }
    }

    async doingQuest(quest, channel = null, userId = null, allQuests = [], sessionMessageRef = { msg: null }, userName = 'User') {
        const isAndroid =
            Boolean(quest.config.task_config_v2?.tasks?.WATCH_VIDEO_ON_MOBILE) &&
            !Boolean(quest.config.task_config_v2?.tasks?.WATCH_VIDEO);

        if (!quest.isEnrolledQuest()) {
            const enrolled = await this.acceptQuest(quest.id, isAndroid);
            if (!enrolled) return false;
            await this.#timeout(1000);
        }

        const taskConfig = quest.config.task_config ?? quest.config.task_config_v2;
        if (!taskConfig || !taskConfig.tasks) return false;

        const tasks = taskConfig.tasks ?? {};
        const availableTaskTypes = Object.keys(tasks);
        if (availableTaskTypes.length === 0) return false;

        const taskName = availableTaskTypes[0];
        const task = tasks[taskName];
        const secondsNeeded = task?.target || task?.seconds || 30;
        const eventName = task?.event_name ?? task?.type ?? taskName;

        const intervalTimer = setInterval(async () => {
            try {
                await this.#refreshQuestStatus(quest);
                if (channel && allQuests.length > 0) {
                    await QuestManager.updateSessionBox(channel, allQuests, sessionMessageRef, userName);
                }
            } catch {}
        }, 20000);

        try {
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

                        const res = await this.#safeRequest(() => 
                            this.client.post(`/quests/${quest.id}/video-progress`, payload)
                        );
                        if (res) quest.updateUserStatus(extractStatus(res));

                        if (channel) await QuestManager.updateSessionBox(channel, allQuests, sessionMessageRef, userName);
                        if (quest.isCompleted()) break;

                        secondsDone += Math.min(10, Math.max(5, Math.floor(targetSecs / 4)));
                        if (secondsDone > targetSecs) secondsDone = targetSecs;
                    } catch (err) {
                        await this.#timeout(3000);
                    }
                    await this.#timeout(2000);
                }

                try {
                    await this.#safeRequest(() => 
                        this.client.post(`/quests/${quest.id}/video-progress`, {
                            timestamp: targetSecs,
                            task_id: currentTaskId,
                        })
                    );
                } catch {}

                await this.#refreshQuestStatus(quest);

            } else {
                const maxDurationMs = (secondsNeeded + 300) * 1000;
                const startTime = Date.now();

                while (!quest.isCompleted()) {
                    if (Date.now() - startTime > maxDurationMs) break;

                    try {
                        const res = await this.#safeRequest(() => 
                            this.client.post(`/quests/${quest.id}/heartbeat`, { 
                                application_id: quest.config.application?.id,
                                stream_key: null, 
                                terminal: false 
                            })
                        );
                        if (res) quest.updateUserStatus(extractStatus(res));
                    } catch (err) {
                        await this.#timeout(4000);
                        continue;
                    }

                    if (channel) await QuestManager.updateSessionBox(channel, allQuests, sessionMessageRef, userName);

                    const done = readProgress(quest, eventName, taskName);
                    if (done >= secondsNeeded || quest.isCompleted()) break;
                    
                    await this.#timeout(4000);
                }

                try {
                    await this.#safeRequest(() => 
                        this.client.post(`/quests/${quest.id}/heartbeat`, { 
                            application_id: quest.config.application?.id,
                            stream_key: null, 
                            terminal: true 
                        })
                    );
                } catch {}
            }
        } finally {
            clearInterval(intervalTimer);
        }

        if (channel) {
            await QuestManager.updateSessionBox(channel, allQuests, sessionMessageRef, userName);
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
