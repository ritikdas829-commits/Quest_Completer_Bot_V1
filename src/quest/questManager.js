import { Quest } from './quest.js';
import { EmbedBuilder } from 'discord.js';

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
                        logFn(
                            `Claimed reward for quest: ${quest.id}`,
                        );
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
            const response =
                await this.client.get('/quests/@me');

            if (!Array.isArray(response?.quests)) {
                return false;
            }

            const updated = response.quests.find(
                (q) => q.id === quest.id,
            );

            if (updated?.user_status) {
                quest.updateUserStatus(
                    updated.user_status,
                );

                return true;
            }
        } catch {}

        return false;
    }

    async refreshAll() {
        try {
            const response =
                await this.client.get('/quests/@me');

            if (!Array.isArray(response?.quests)) {
                return false;
            }

            for (const data of response.quests) {
                const existing =
                    this.#quests.get(data.id);

                if (
                    existing &&
                    data.user_status
                ) {
                    existing.updateUserStatus(
                        data.user_status,
                    );
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    static async updateSessionBox(
        channel,
        questList = [],
    ) {
        if (!channel) return;

        QuestManager.#updateLock =
            QuestManager.#updateLock
                .catch(() => {})
                .then(async () => {
                    await QuestManager.#renderSessionBox(
                        channel,
                        questList,
                    );
                });

        return QuestManager.#updateLock;
    }

    static async #renderSessionBox(
        channel,
        questList,
    ) {
        const quests = Array.isArray(questList)
            ? questList
            : [];

        let completedCount = 0;
        let totalOrbs = 0;

        const sections = [];

        for (const quest of quests) {
            if (!quest) continue;

            const name =
                quest.config?.messages?.quest_name ||
                'Unknown Quest';

            const completed =
                Boolean(quest.isCompleted?.());

            if (completed) {
                completedCount++;
            }

            const reward = getRewardInfo(quest);

            if (completed) {
                totalOrbs += reward.amount;
            }

            const progress =
                getProgressInfo(quest);

            const progressText =
                progress.target > 0
                    ? `\`${formatNumber(progress.value)} / ${formatNumber(progress.target)}\``
                    : '`Waiting for server data`';

            let status;

            if (completed) {
                status = '🟢 **COMPLETED**';
            } else if (progress.value > 0) {
                status = '🟡 **IN PROGRESS**';
            } else {
                status = '⏳ **WAITING**';
            }

            sections.push(
                [
                    `◆ **${escapeMarkdown(name)}**`,
                    `├ 🎁 **Reward:** \`${escapeMarkdown(reward.name)}${reward.amount > 0 ? ` • ${reward.amount}` : ''}\``,
                    `├ 📈 **Progress:** ${progressText}`,
                    `└ ⚡ **Status:** ${status}`,
                ].join('\n'),
            );
        }

        const total = quests.length;

        const percentage =
            total > 0
                ? Math.round(
                    (completedCount / total) * 100,
                )
                : 0;

        const allCompleted =
            total > 0 &&
            completedCount === total;

        const header = [
            '┏━━━ 🤖 **QUEST PIPELINE V5** 🤖 ━━━┓',
            `┃ 📊 **Progress:** \`${completedCount} / ${total} Done\``,
            `┃ 📈 **Completion:** \`${percentage}%\``,
            `┃ 💎 **Earned:** \`${formatNumber(totalOrbs)} Orbs\``,
            `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`,
        ].join('\n');

        const dashboardStatus = allCompleted
            ? '🟢 **ALL QUESTS COMPLETED**'
            : '🟣 **QUEST PIPELINE ACTIVE**';

        const embed = new EmbedBuilder()
            .setColor(
                allCompleted
                    ? '#00FF66'
                    : '#9b59b6',
            )
            .setTitle(
                '🧠 Quest Progress Dashboard',
            )
            .setDescription(
                [
                    header,
                    '',
                    dashboardStatus,
                    '',
                    sections.length
                        ? sections.join('\n\n')
                        : '⏳ No quests found.',
                ].join('\n'),
            )
            .setFooter({
                text: 'InSaNe DyNaStY • Live Quest Monitor',
            })
            .setTimestamp();

        if (QuestManager.activeSessionMessage) {
            try {
                await QuestManager.activeSessionMessage.edit({
                    embeds: [embed],
                });

                return;
            } catch {
                QuestManager.activeSessionMessage = null;
            }
        }

        try {
            QuestManager.activeSessionMessage =
                await channel.send({
                    embeds: [embed],
                });
        } catch {
            QuestManager.activeSessionMessage = null;
        }
    }

    static resetSessionMessage() {
        QuestManager.activeSessionMessage = null;
    }

    async doingQuest(
        quest,
        channel = null,
        userId = null,
        allQuests = [],
    ) {
        if (!quest) return false;

        /*
         * Detect which task the quest actually contains.
         * This fixes the old "first task only" behaviour.
         */
        const taskInfo =
            detectTask(quest);

        if (!taskInfo) {
            if (channel) {
                await QuestManager.updateSessionBox(
                    channel,
                    allQuests,
                );
            }

            return false;
        }

        /*
         * Detect mobile-only quests.
         */
        const isAndroid =
            taskInfo.name ===
            QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE;

        /*
         * Enroll the quest when necessary.
         */
        if (!quest.isEnrolledQuest()) {
            const enrolled =
                await this.acceptQuest(
                    quest.id,
                    isAndroid,
                );

            if (!enrolled) {
                return false;
            }

            await timeout(1000);
        }

        /*
         * IMPORTANT:
         *
         * This version does not fabricate video/heartbeat
         * progress. It refreshes the real server status and
         * lets the actual Discord activity generate progress.
         */

        const refreshInterval =
            setInterval(async () => {
                await this.refreshQuest(quest);

                if (channel) {
                    await QuestManager.updateSessionBox(
                        channel,
                        allQuests,
                    );
                }
            }, 5000);

        try {
            /*
             * Immediately show current server state.
             */
            await this.refreshQuest(quest);

            if (channel) {
                await QuestManager.updateSessionBox(
                    channel,
                    allQuests,
                );
            }

            /*
             * Wait while the real activity is progressing.
             *
             * The maximum wait is based on the task target,
             * with an additional safety buffer.
             */
            const target =
                taskInfo.target > 0
                    ? taskInfo.target
                    : 60;

            const maxWait =
                Math.max(
                    120000,
                    (target + 120) * 1000,
                );

            const start =
                Date.now();

            while (!quest.isCompleted()) {
                if (
                    Date.now() - start >
                    maxWait
                ) {
                    break;
                }

                await timeout(5000);

                await this.refreshQuest(quest);

                if (channel) {
                    await QuestManager.updateSessionBox(
                        channel,
                        allQuests,
                    );
                }
            }
        } finally {
            clearInterval(refreshInterval);
        }

        await this.refreshQuest(quest);

        if (channel) {
            await QuestManager.updateSessionBox(
                channel,
                allQuests,
            );
        }

        return quest.isCompleted();
    }
}

/*
 * Find the correct configured task instead of blindly
 * selecting tasks[0].
 */
function detectTask(quest) {
    const configs = [
        quest?.config?.task_config_v2,
        quest?.config?.task_config,
    ].filter(Boolean);

    const preferred = [
        QuestTaskConfigType.WATCH_VIDEO,
        QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE,
        QuestTaskConfigType.WATCH_VIDEO_EMBED,
        QuestTaskConfigType.WATCH_VIDEO_BY_STREAM,
        QuestTaskConfigType.LEARN_MORE,
        QuestTaskConfigType.PLAY_ACTIVITY,
        QuestTaskConfigType.PLAY_ON_DESKTOP,
        QuestTaskConfigType.STREAM_ON_DESKTOP,
        QuestTaskConfigType.PLAY_ON_XBOX,
        QuestTaskConfigType.PLAY_ON_PLAYSTATION,
        QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY,
    ];

    for (const config of configs) {
        const tasks = config?.tasks;

        if (
            !tasks ||
            typeof tasks !== 'object'
        ) {
            continue;
        }

        /*
         * Prefer known task types.
         */
        for (const type of preferred) {
            if (tasks[type]) {
                const task = tasks[type];

                return {
                    name: type,
                    task,
                    eventName:
                        task?.event_name ??
                        task?.type ??
                        type,
                    target:
                        getTarget(task),
                };
            }
        }

        /*
         * Fallback for future/unknown task types.
         */
        const firstName =
            Object.keys(tasks)[0];

        if (firstName) {
            const task =
                tasks[firstName];

            return {
                name: firstName,
                task,
                eventName:
                    task?.event_name ??
                    task?.type ??
                    firstName,
                target:
                    getTarget(task),
            };
        }
    }

    return null;
}

function getTarget(task) {
    const value =
        Number(
            task?.target ??
            task?.seconds ??
            task?.duration ??
            0,
        );

    return Number.isFinite(value) && value > 0
        ? value
        : 0;
}

function getProgressInfo(quest) {
    const progress =
        quest?.userStatus?.progress;

    if (
        !progress ||
        typeof progress !== 'object'
    ) {
        return {
            value: 0,
            target: 0,
        };
    }

    let best = {
        value: 0,
        target: 0,
    };

    for (const key of Object.keys(progress)) {
        const item = progress[key];

        if (!item) continue;

        const value =
            Number(item.value);

        const target =
            Number(
                item.target ??
                item.total ??
                item.required ??
                0,
            );

        if (
            Number.isFinite(value) &&
            value >= best.value
        ) {
            best = {
                value,
                target:
                    Number.isFinite(target)
                        ? target
                        : 0,
            };
        }
    }

    return best;
}

function getRewardInfo(quest) {
    const rewards =
        quest?.config
            ?.rewards_config
            ?.rewards;

    if (
        !Array.isArray(rewards) ||
        rewards.length === 0
    ) {
        return {
            name: 'Orbs',
            amount: 0,
        };
    }

    const reward =
        rewards[0];

    const amount =
        Number(reward?.orb_quantity);

    return {
        name:
            reward?.messages?.name ||
            'Orbs',

        amount:
            Number.isFinite(amount) &&
            amount > 0
                ? amount
                : 0,
    };
}

function extractStatus(res) {
    if (
        res &&
        typeof res === 'object' &&
        res.user_status
    ) {
        return res.user_status;
    }

    return res;
}

function formatNumber(value) {
    const number =
        Number(value);

    if (!Number.isFinite(number)) {
        return '0';
    }

    return Number.isInteger(number)
        ? number.toLocaleString()
        : number.toFixed(1);
}

function escapeMarkdown(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/([*_~`|>])/g, '\\$1');
}

function timeout(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export { QuestTaskConfigType };
