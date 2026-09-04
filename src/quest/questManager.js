import { Quest } from './quest.js';
import { EmbedBuilder } from 'discord.js';
import {
    detectTask,
    getProgressInfo,
    readProgressForAction,
    getRewardInfo,
    extractStatus,
    formatNumber,
    escapeMarkdown,
    timeout,
} from './questHelper.js';

const QuestTaskConfigType = {
    WATCH_VIDEO: 'WATCH_VIDEO',
    PLAY_ON_DESKTOP: 'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP: 'STREAM_ON_DESKTOP',
    PLAY_ACTIVITY: 'PLAY_ACTIVITY',
    WATCH_VIDEO_ON_MOBILE: 'WATCH_VIDEO_ON_MOBILE',
    WATCH_VIDEO_BY_STREAM: 'WATCH_VIDEO_BY_STREAM',
    LEARN_MORE: 'LEARN_MORE',
    WATCH_VIDEO_EMBED: 'WATCH_VIDEO_EMBED',
    PLAY_ON_XBOX: 'PLAY_ON_XBOX',
    PLAY_ON_PLAYSTATION: 'PLAY_ON_PLAYSTATION',
    ACHIEVEMENT_IN_ACTIVITY: 'ACHIEVEMENT_IN_ACTIVITY',
};

export class QuestManager {
    #quests = new Map();
    client;

    static activeSessionMessage = null;
    static #updateLock = Promise.resolve();

    constructor(client, quests = []) {
        this.client = client;
        for (const quest of quests) {
            if (quest?.id) {
                this.#quests.set(quest.id, quest);
            }
        }
    }

    static fromResponse(client, response) {
        if (!response) {
            throw new Error('Invalid quest response.');
        }

        if (response.quest_enrollment_blocked_until !== null) {
            throw new Error(
                `Quest enrollment is blocked until ${response.quest_enrollment_blocked_until}.`,
            );
        }

        return new QuestManager(
            client,
            Array.isArray(response.quests)
                ? response.quests.map((quest) => Quest.create(quest))
                : [],
        );
    }

    [Symbol.iterator]() {
        return this.#quests.values();
    }

    get size() {
        return this.#quests.size;
    }

    list() {
        return Array.from(this.#quests.values());
    }

    get(id) {
        return this.#quests.get(id);
    }

    upsert(quest) {
        if (!quest?.id) return false;
        this.#quests.set(quest.id, quest);
        return true;
    }

    remove(id) {
        return this.#quests.delete(id);
    }

    clear() {
        this.#quests.clear();
    }

    hasQuest(id) {
        return this.#quests.has(id);
    }

    getExpired(date = new Date()) {
        return this.list().filter((q) => q.isExpired(date));
    }

    getCompleted() {
        return this.list().filter((q) => q.isCompleted());
    }

    getClaimable() {
        return this.list().filter(
            (q) =>
                q.isCompleted() &&
                !q.hasClaimedRewards(),
        );
    }

    filterQuestsValid() {
        return this.list().filter(
            (q) =>
                !q.isCompleted() &&
                !q.isExpired(),
        );
    }

    async claimRewards(logFn) {
        await this.refreshAll();

        const claimable = this.getClaimable();
        let claimed = 0;

        for (const quest of claimable) {
            try {
                const response = await this.client.post(
                    `/quests/${quest.id}/claim-reward`,
                    {
                        location: 11,
                        is_targeted: false,
                        metadata_raw: null,
                    },
                );

                if (response) {
                    claimed++;
                    if (typeof logFn === 'function') {
                        logFn(`Claimed reward for quest: ${quest.id}`);
                    }
                }

                await timeout(1500);
            } catch {
                continue;
            }
        }

        return claimed;
    }

    async acceptQuest(questId, isAndroid = false) {
        if (!questId) return null;

        try {
            const response = await this.client.post(
                `/quests/${questId}/enroll`,
                {
                    location: isAndroid ? 12 : 11,
                    is_targeted: false,
                    metadata_raw: null,
                },
            );

            const quest = this.get(questId);

            if (quest && response) {
                const status = extractStatus(response);
                if (status) {
                    quest.updateUserStatus(status);
                }
            }

            return quest ?? null;
        } catch {
            return null;
        }
    }

    async refreshQuest(quest) {
        if (!quest?.id) return false;

        try {
            const response = await this.client.get('/quests/@me');
            if (!Array.isArray(response?.quests)) {
                return false;
            }

            const updated = response.quests.find((q) => q.id === quest.id);
            if (!updated) {
                return false;
            }

            if (updated.user_status) {
                quest.updateUserStatus(updated.user_status);
            }

            return true;
        } catch {
            return false;
        }
    }

    async refreshAll() {
        try {
            const response = await this.client.get('/quests/@me');
            if (!Array.isArray(response?.quests)) {
                return false;
            }

            for (const data of response.quests) {
                const existing = this.#quests.get(data.id);
                if (existing && data.user_status) {
                    existing.updateUserStatus(data.user_status);
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    static async updateSessionBox(channel, questList = []) {
        if (!channel) return;

        QuestManager.#updateLock = QuestManager.#updateLock
            .catch(() => {})
            .then(async () => {
                await QuestManager.#renderSessionBox(channel, questList);
            });

        return QuestManager.#updateLock;
    }

    static async #renderSessionBox(channel, questList) {
        const quests = Array.isArray(questList) ? questList.filter(Boolean) : [];

        let completedCount = 0;
        let totalOrbs = 0;
        const sections = [];

        for (const quest of quests) {
            const name = quest.config?.messages?.quest_name || 'Unknown Quest';
            const completed = Boolean(quest.isCompleted?.());

            if (completed) {
                completedCount++;
            }

            const reward = getRewardInfo(quest);
            if (completed) {
                totalOrbs += reward.amount;
            }

            const task = detectTask(quest);
            const progress = getProgressInfo(quest, task);

            let status = '⏳ **WAITING**';
            if (completed) {
                status = '🟢 **COMPLETED**';
            } else if (progress.value > 0) {
                status = '🟡 **IN PROGRESS**';
            }

            const progressText = progress.target > 0
                ? `\`${formatNumber(progress.value)} / ${formatNumber(progress.target)}\``
                : '`Waiting for server data`';

            const taskText = task?.name ? `\`${task.name}\`` : '`Unknown`';

            sections.push(
                [
                    `◆ **${escapeMarkdown(name)}**`,
                    `├ 🎯 **Task:** ${taskText}`,
                    `├ 🎁 **Reward:** \`${escapeMarkdown(reward.name)}${reward.amount > 0 ? ` • ${reward.amount}` : ''}\``,
                    `├ 📈 **Progress:** ${progressText}`,
                    `└ ⚡ **Status:** ${status}`,
                ].join('\n'),
            );
        }

        const total = quests.length;
        const percentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        const allCompleted = total > 0 && completedCount === total;

        const header = [
            '┏━━━ 🤖 **QUEST PIPELINE V6** 🤖 ━━━┓',
            `┃ 📊 **Progress:** \`${completedCount} / ${total} Done\``,
            `┃ 📈 **Completion:** \`${percentage}%\``,
            `┃ 💎 **Earned:** \`${formatNumber(totalOrbs)} Orbs\``,
            `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`,
        ].join('\n');

        const dashboardStatus = allCompleted
            ? '🟢 **ALL QUESTS COMPLETED**'
            : '🟣 **QUEST PIPELINE ACTIVE**';

        const embed = new EmbedBuilder()
            .setColor(allCompleted ? '#00FF66' : '#9b59b6')
            .setTitle('🧠 Quest Progress Dashboard')
            .setDescription(
                [
                    header,
                    '',
                    dashboardStatus,
                    '',
                    sections.length > 0 ? sections.join('\n\n') : '⏳ No quests found.',
                ].join('\n'),
            )
            .setFooter({ text: 'InSaNe DyNaStY • Live Quest Monitor' })
            .setTimestamp();

        if (QuestManager.activeSessionMessage) {
            try {
                await QuestManager.activeSessionMessage.edit({ embeds: [embed] });
                return;
            } catch {
                QuestManager.activeSessionMessage = null;
            }
        }

        try {
            QuestManager.activeSessionMessage = await channel.send({ embeds: [embed] });
        } catch {
            QuestManager.activeSessionMessage = null;
        }
    }

    static resetSessionMessage() {
        QuestManager.activeSessionMessage = null;
    }

    async doingQuest(quest, channel = null, userId = null, allQuests = []) {
        if (!quest) return false;

        const task = detectTask(quest);
        if (!task) {
            if (channel) {
                await QuestManager.updateSessionBox(channel, allQuests);
            }
            return false;
        }

        const isAndroid = task.name === QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE;

        if (!quest.isEnrolledQuest()) {
            const enrolled = await this.acceptQuest(quest.id, isAndroid);
            if (!enrolled) {
                return false;
            }
            await timeout(1000);
        }

        await this.refreshQuest(quest);
        if (channel) {
            await QuestManager.updateSessionBox(channel, allQuests);
        }

        const taskName = task.name;
        const eventName = task.eventName;
        const targetSecs = task.target > 0 ? task.target : 30;

        const refreshTimer = setInterval(async () => {
            await this.refreshQuest(quest);
            if (channel) {
                await QuestManager.updateSessionBox(channel, allQuests);
            }
        }, 10000);

        try {
            if (
                taskName.includes('WATCH') || 
                taskName.includes('VIDEO') || 
                taskName.includes('LEARN') || 
                taskName.includes('EMBED')
            ) {
                let secondsDone = readProgressForAction(quest, eventName, taskName);

                while (!quest.isCompleted() && secondsDone <= targetSecs) {
                    try {
                        const payload = {
                            timestamp: secondsDone,
                            task_id: taskName,
                        };
                        if (eventName) payload.event_name = eventName;

                        const res = await this.client.post(`/quests/${quest.id}/video-progress`, payload);
                        if (res) quest.updateUserStatus(extractStatus(res));

                        if (channel) await QuestManager.updateSessionBox(channel, allQuests);
                        if (quest.isCompleted()) break;

                        secondsDone += Math.min(10, Math.max(5, Math.floor(targetSecs / 4)));
                        if (secondsDone > targetSecs) secondsDone = targetSecs;
                    } catch {}
                    await timeout(2000);
                }

                try {
                    const finalRes = await this.client.post(`/quests/${quest.id}/video-progress`, {
                        timestamp: targetSecs,
                        task_id: taskName,
                    });
                    if (finalRes) quest.updateUserStatus(extractStatus(finalRes));
                } catch {}

            } else {
                const maxDurationMs = (targetSecs + 300) * 1000;
                const startTime = Date.now();

                while (!quest.isCompleted()) {
                    if (Date.now() - startTime > maxDurationMs) break;

                    try {
                        const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { 
                            application_id: quest.config.application?.id,
                            stream_key: null, 
                            terminal: false 
                        });
                        if (res) quest.updateUserStatus(extractStatus(res));
                    } catch {
                        await timeout(3000);
                        continue;
                    }

                    if (channel) await QuestManager.updateSessionBox(channel, allQuests);

                    const done = readProgressForAction(quest, eventName, taskName);
                    if (done >= targetSecs || quest.isCompleted()) break;

                    await timeout(4000);
                }

                try {
                    await this.client.post(`/quests/${quest.id}/heartbeat`, { 
                        application_id: quest.config.application?.id,
                        stream_key: null, 
                        terminal: true 
                    });
                } catch {}
            }
        } finally {
            clearInterval(refreshTimer);
        }

        await this.refreshQuest(quest);
        if (channel) {
            await QuestManager.updateSessionBox(channel, allQuests);
        }

        return Boolean(quest.isCompleted());
    }
}

export { QuestTaskConfigType };
