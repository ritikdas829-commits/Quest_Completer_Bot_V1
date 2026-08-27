import { Quest } from './quest.js';
import { EmbedBuilder } from 'discord.js';

const QuestTaskConfigType = {
    WATCH_VIDEO:           'WATCH_VIDEO',
    PLAY_ON_DESKTOP:       'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP:     'STREAM_ON_DESKTOP',
    PLAY_ACTIVITY:         'PLAY_ACTIVITY',
    WATCH_VIDEO_ON_MOBILE: 'WATCH_VIDEO_ON_MOBILE',
};

export class QuestManager {
    #quests = new Map();
    client;
    static activeSessionMessage = null;
    static #updateLock = Promise.resolve();

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
            (q) => q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired(),
        );
    }

    async claimRewards(log = console.log) {
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
                await this.client.post(`/quests/${quest.id}/claim-reward`);
                claimed++;
            } catch (err) {}
        }
        return claimed;
    }

    async acceptQuest(questId) {
        const r = await this.client.post(`/quests/${questId}/enroll`, {
            location: 11,
            is_targeted: false,
            metadata_raw: null,
        });
        const quest = this.get(questId);
        quest?.updateUserStatus(extractStatus(r));
        return quest;
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

    static async updateSessionBox(channel, questList, currentQuestName, statusType) {
        if (!channel) return;
        
        QuestManager.#updateLock = QuestManager.#updateLock.then(async () => {
            try {
                let description = '';
                let completedCount = 0;

                questList.forEach((q) => {
                    if (q.isCompleted()) completedCount++;
                });

                const totalQuests = questList.length;

                questList.forEach((q) => {
                    const qName = q.config.messages.quest_name;
                    let rewardText = 'Orbs';
                    const rewards = q.config.rewards_config?.rewards;
                    if (rewards && rewards.length > 0) {
                        rewardText = rewards[0].messages?.name || 'Orbs';
                    }

                    let status = '♡ waiting';
                    if (q.isCompleted()) {
                        status = '✓ done';
                    } else if (qName === currentQuestName) {
                        status = statusType;
                    }

                    description += `**♡ ${qName}**\n└ ${rewardText}\n> ${status}\n\n`;
                });

                const headerText = `🤍 in progress · ${completedCount} of ${totalQuests} complete`;

                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('♡ quest session')
                    .setDescription(`*${headerText}*\n\n${description.trim()}`);

                if (QuestManager.activeSessionMessage) {
                    await QuestManager.activeSessionMessage.edit({ embeds: [embed] }).catch(() => {});
                } else {
                    QuestManager.activeSessionMessage = await channel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (err) {}
        });

        await QuestManager.#updateLock;
    }

    async doingQuest(quest, log = console.log, channel = null, userId = null, allQuests = []) {
        const questName = quest.config.messages.quest_name;

        if (!quest.isEnrolledQuest()) {
            await QuestManager.updateSessionBox(channel, allQuests, questName, '♡ enrolling...');
            try {
                await this.acceptQuest(quest.id);
            } catch (err) {
                await QuestManager.updateSessionBox(channel, allQuests, questName, '❌ failed');
                return false;
            }
        }

        const taskConfig = quest.config.task_config ?? quest.config.task_config_v2;
        if (!taskConfig) return false;

        const tasks = taskConfig.tasks ?? {};
        const TASK_TYPES = Object.values(QuestTaskConfigType);
        const taskName = TASK_TYPES.find((x) => tasks[x] != null);
        if (!taskName) return false;

        const task = tasks[taskName];
        const secondsNeeded = task.target;
        const eventName = task.event_name ?? task.type ?? taskName;

        if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
            let secondsDone = readProgress(quest, eventName, taskName);

            while (secondsDone < secondsNeeded) {
                try {
                    secondsDone = Math.min(secondsNeeded, secondsDone + 15);
                    const res = await this.client.post(`/quests/${quest.id}/video-progress`, {
                        timestamp: secondsDone,
                    });
                    
                    await QuestManager.updateSessionBox(channel, allQuests, questName, '♡ running');

                    if (res?.completed_at || res?.user_status?.completed_at) break;
                } catch (err) {
                    await this.#timeout(2000);
                }
                await this.#timeout(500);
            }

            try {
                await this.client.post(`/quests/${quest.id}/video-progress`, { timestamp: secondsNeeded });
            } catch {}

        } else if (taskName === 'PLAY_ON_DESKTOP' || taskName === 'STREAM_ON_DESKTOP') {
            const maxDurationMs = (secondsNeeded + 300) * 1000;
            const startTime = Date.now();
            let consecutiveErrors = 0;

            while (!quest.isCompleted()) {
                if (Date.now() - startTime > maxDurationMs) break;

                try {
                    const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: false });
                    quest.updateUserStatus(extractStatus(res));
                    consecutiveErrors = 0;
                } catch (err) {
                    consecutiveErrors++;
                    if (consecutiveErrors >= 5) return false;
                    await this.#timeout(3000);
                    continue;
                }

                await this.#refreshQuestStatus(quest);
                await QuestManager.updateSessionBox(channel, allQuests, questName, '♡ running');

                const done = readProgress(quest, eventName, taskName);
                if (done >= secondsNeeded || quest.isCompleted()) break;
                
                await this.#timeout(10000);
            }

            try {
                const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: true });
                quest.updateUserStatus(extractStatus(res));
            } catch {}
        }

        await QuestManager.updateSessionBox(channel, allQuests, questName, '✓ done');

        if (userId) {
            try {
                const user = await this.client.users.fetch(userId);
                if (user) {
                    await user.send(`✅ Your quest **"${questName}"** has been successfully completed! 🎉`);
                }
            } catch (dmErr) {}
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
    const byEvent = eventName ? progress[eventName]?.value : undefined;
    const byTask  = progress[taskName]?.value;
    return Number(byEvent ?? byTask ?? 0) || 0;
}

