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

    static async updateSessionBox(channel, questList) {
        if (!channel) return;
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

                let status = q.isCompleted() ? '✨ done' : '⚡ running';

                description += `🔹 **${qName}**\n` +
                               `┗ 🎁 **Reward:** ${rewardText}\n` +
                               `┗ 📌 **Status:** ${status}\n\n`;
            });

            const headerText = `🚀 **Quest Session Complete**\n📊 **Progress:** \`${completedCount} / ${totalQuests} Completed\``;

            const embed = new EmbedBuilder()
                .setColor('#ff75a0')
                .setTitle('✨ Coquettes Style Autoprogess')
                .setDescription(`${headerText}\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n${description.trim()}`)
                .setFooter({ text: 'Auto Runner • Multi-threaded' })
                .setTimestamp();

            if (QuestManager.activeSessionMessage) {
                await QuestManager.activeSessionMessage.edit({ embeds: [embed] }).catch(() => {});
            } else {
                QuestManager.activeSessionMessage = await channel.send({ embeds: [embed] }).catch(() => {});
            }
        } catch (err) {}
    }

    async doingQuest(quest, log = console.log, channel = null, userId = null, allQuests = []) {
        const questName = quest.config.messages.quest_name;

        if (!quest.isEnrolledQuest()) {
            try {
                await this.acceptQuest(quest.id);
            } catch (err) {
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
        const secondsNeeded = task.target || 30;
        const eventName = task.event_name ?? task.type ?? taskName;

        if (
            taskName === 'WATCH_VIDEO' || 
            taskName === 'WATCH_VIDEO_ON_MOBILE' || 
            taskName === 'WATCH_VIDEO_BY_STREAM' || 
            taskName === 'LEARN_MORE' ||
            taskName === 'WATCH_VIDEO_EMBED'
        ) {
            let secondsDone = readProgress(quest, eventName, taskName);

            while (!quest.isCompleted() && secondsDone < secondsNeeded) {
                try {
                    secondsDone = Math.min(secondsNeeded, secondsDone + 15);
                    const res = await this.client.post(`/quests/${quest.id}/video-progress`, {
                        timestamp: secondsDone,
                    });
                    
                    if (res?.user_status) {
                        quest.updateUserStatus(extractStatus(res));
                    }
                    
                    if (res?.completed_at || res?.user_status?.completed_at || quest.isCompleted()) {
                        break;
                    }
                } catch (err) {
                    await this.#timeout(2000);
                }
                await this.#timeout(2000);
            }

            try {
                const finalRes = await this.client.post(`/quests/${quest.id}/video-progress`, { timestamp: secondsNeeded });
                if (finalRes) quest.updateUserStatus(extractStatus(finalRes));
            } catch {}

            await this.#refreshQuestStatus(quest);

        } else if (taskName === 'PLAY_ON_DESKTOP' || taskName === 'STREAM_ON_DESKTOP') {
            const maxDurationMs = (secondsNeeded + 300) * 1000;
            const startTime = Date.now();

            while (!quest.isCompleted()) {
                if (Date.now() - startTime > maxDurationMs) break;

                try {
                    const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: false });
                    quest.updateUserStatus(extractStatus(res));
                } catch (err) {
                    await this.#timeout(3000);
                    continue;
                }

                const done = readProgress(quest, eventName, taskName);
                if (done >= secondsNeeded || quest.isCompleted()) break;
                
                await this.#timeout(5000);
            }

            try {
                const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: true });
                quest.updateUserStatus(extractStatus(res));
            } catch {}
        }

        // Background session box update (non-blocking)
        QuestManager.updateSessionBox(channel, allQuests);

        if (userId) {
            try {
                const user = await this.client.users.fetch(userId);
                if (user) {
                    await user.send(`✨ **${questName}**\n↳ 200 Orbs\n✓ done`);
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

