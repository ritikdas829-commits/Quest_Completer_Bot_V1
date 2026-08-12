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
    liveMessage = null; // Used to track the live progress message

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
        } catch { /* use stale state */ }

        const claimable = this.getClaimable();
        let claimed = 0;
        for (const quest of claimable) {
            try {
                await this.client.post(`/quests/${quest.id}/claim-reward`);
                claimed++;
                log(`Claimed reward for "${quest.config.messages.quest_name}"`);
            } catch (err) {
                log(`Could not claim reward for "${quest.config.messages.quest_name}": ${err.message}`);
            }
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
        } catch { /* ignore */ }
    }

    async doingQuest(quest, log = console.log, channel = null, userId = null) {
        const questName = quest.config.messages.quest_name;

        // Function to create or update the live progress message box
        const updateLiveBox = async (statusText) => {
            if (!channel) return;
            try {
                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('♡ quest session in progress')
                    .setDescription(`**♡ ${questName}**\n└ ${quest.config.messages.rewards_summary || 'Orbs'}\n${statusText}`);
                
                if (this.liveMessage) {
                    await this.liveMessage.edit({ embeds: [embed] }).catch(() => {});
                } else {
                    this.liveMessage = await channel.send({ embeds: [embed] }).catch(() => {});
                }
            } catch (err) {
                // Ignore errors if message sending fails
            }
        };

        if (!quest.isEnrolledQuest()) {
            log(`Enrolling in quest "${questName}"...`);
            await updateLiveBox('♡ enrolling...');
            try {
                await this.acceptQuest(quest.id);
            } catch (err) {
                log(`Could not enroll in "${questName}": ${err.message}`);
                await updateLiveBox('❌ enrollment failed');
                return false;
            }
        }

        const taskConfig = quest.config.task_config ?? quest.config.task_config_v2;
        if (!taskConfig) {
            log(`[FAIL] "${questName}": task_config is missing from Discord's response.`);
            await updateLiveBox('❌ task config missing');
            return false;
        }

        const tasks = taskConfig.tasks ?? {};
        const allKeys = Object.keys(tasks);
        log(`[INFO] "${questName}": task keys = [${allKeys.join(', ')}]`);

        const TASK_TYPES = Object.values(QuestTaskConfigType);
        const taskName = TASK_TYPES.find((x) => tasks[x] != null);

        if (!taskName) {
            log(`[FAIL] "${questName}": unsupported task type(s) [${allKeys.join(', ')}].`);
            await updateLiveBox('❌ unsupported task');
            return false;
        }

        log(`[INFO] "${questName}": using task type "${taskName}"`);

        const task = tasks[taskName];
        const secondsNeeded = task.target;
        const eventName = task.event_name ?? task.type ?? taskName;
        const applicationName = quest.config.application.name;

        if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
            const maxFuture = 10, speed = 7, interval = 1;
            const enrolledAt = quest.userStatus?.enrolled_at
                ? new Date(quest.userStatus.enrolled_at).getTime()
                : Date.now();

            let secondsDone = readProgress(quest, eventName, taskName);

            while (true) {
                const elapsed = Math.floor((Date.now() - enrolledAt) / 1000);
                const maxAllowed = elapsed + maxFuture;
                const diff = maxAllowed - secondsDone;
                const timestamp = secondsDone + speed;

                if (diff >= speed) {
                    try {
                        const res = await this.client.post(`/quests/${quest.id}/video-progress`, {
                            timestamp: Math.min(secondsNeeded, timestamp + Math.random()),
                        });
                        secondsDone = Math.min(secondsNeeded, timestamp);
                        
                        // Update live box with progress percentage
                        const percent = Math.floor((secondsDone / secondsNeeded) * 100);
                        await updateLiveBox(`♡ running (${percent}%)`);

                        if (res?.completed_at || res?.user_status?.completed_at) break;
                    } catch (err) {
                        log(`Video progress beat failed for "${questName}": ${err.message}. Retrying...`);
                    }
                }

                if (secondsDone >= secondsNeeded) break;
                await this.#timeout(interval * 1000);
            }

            try {
                await this.client.post(`/quests/${quest.id}/video-progress`, { timestamp: secondsNeeded });
            } catch { /* best effort */ }

        } else if (taskName === 'PLAY_ON_DESKTOP') {
            const interval = 30;
            const maxDurationMs = (secondsNeeded + 600) * 1000;
            const startTime = Date.now();
            let beats = 0, consecutiveErrors = 0;

            while (!quest.isCompleted()) {
                if (Date.now() - startTime > maxDurationMs) {
                    log(`Quest "${questName}" timed out.`);
                    await updateLiveBox('❌ timed out');
                    return true;
                }

                try {
                    const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: false });
                    quest.updateUserStatus(extractStatus(res));
                    consecutiveErrors = 0;
                } catch (err) {
                    consecutiveErrors++;
                    log(`Heartbeat failed for "${questName}" (attempt ${consecutiveErrors}): ${err.message}`);
                    if (consecutiveErrors >= 5) { 
                        log(`Too many heartbeat failures for "${questName}". Giving up.`); 
                        await updateLiveBox('❌ failed');
                        return false; 
                    }
                    await this.#timeout(5_000);
                    continue;
                }

                beats++;
                if (beats % 5 === 0) await this.#refreshQuestStatus(quest);

                const done = readProgress(quest, eventName, taskName);
                const remaining = Math.max(0, secondsNeeded - done);
                log(`Spoofed your game to ${applicationName}. About ${Math.ceil(remaining / 60)} more minute(s) to go.`);
                
                // Update live box with remaining time
                await updateLiveBox(`♡ running\n└ About ${Math.ceil(remaining / 60)} min(s) left`);

                if (done >= secondsNeeded || quest.isCompleted()) break;
                await this.#timeout(interval * 1000);
            }

            try {
                const res = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: true });
                quest.updateUserStatus(extractStatus(res));
            } catch { /* best effort */ }

        } else if (taskName === 'STREAM_ON_DESKTOP') {
            log(`Stream quests cannot be completed automatically. Use the Discord desktop app for "${questName}".`);
            await updateLiveBox('❌ stream task not supported');
            return false;
        } else if (taskName === 'PLAY_ACTIVITY') {
            log(`Activity quests are not supported. Use the Discord desktop app for "${questName}".`);
            await updateLiveBox('❌ activity task not supported');
            return false;
        }

        // Quest Successfully Completed!
        log(`Quest "${questName}" completed!`);
        await updateLiveBox('✓ done');

        // Send a Direct Message (DM) to the user when completed
        if (userId) {
            try {
                const user = await this.client.users.fetch(userId);
                if (user) {
                    await user.send(`✅ Your quest **"${questName}"** has been successfully completed! 🎉`);
                }
            } catch (dmErr) {
                log(`Could not send DM to user: ${dmErr.message}`);
            }
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
