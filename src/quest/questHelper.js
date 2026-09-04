const TASK_PRIORITY = [
    'WATCH_VIDEO',
    'WATCH_VIDEO_ON_MOBILE',
    'WATCH_VIDEO_EMBED',
    'WATCH_VIDEO_BY_STREAM',
    'LEARN_MORE',
    'PLAY_ON_DESKTOP',
    'STREAM_ON_DESKTOP',
    'PLAY_ACTIVITY',
    'PLAY_ON_XBOX',
    'PLAY_ON_PLAYSTATION',
    'ACHIEVEMENT_IN_ACTIVITY',
];

export function detectTask(quest) {
    const configs = [
        quest?.config?.task_config_v2,
        quest?.config?.task_config,
    ].filter(Boolean);

    for (const config of configs) {
        const tasks = config?.tasks;
        if (!tasks || typeof tasks !== 'object') continue;

        for (const type of TASK_PRIORITY) {
            if (!tasks[type]) continue;
            const task = tasks[type];
            return {
                name: type,
                task,
                eventName: task?.event_name ?? task?.type ?? type,
                target: getTarget(task),
            };
        }

        const names = Object.keys(tasks);
        for (const name of names) {
            const task = tasks[name];
            if (!task) continue;
            return {
                name,
                task,
                eventName: task?.event_name ?? task?.type ?? name,
                target: getTarget(task),
            };
        }
    }
    return null;
}

export function getTarget(task) {
    const values = [task?.target, task?.seconds, task?.duration, task?.required_seconds];
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
}

export function getProgressInfo(quest, detectedTask = null) {
    const progress = quest?.userStatus?.progress;
    if (!progress || typeof progress !== 'object') {
        return { value: 0, target: detectedTask?.target || 0 };
    }

    if (detectedTask?.eventName && progress[detectedTask.eventName]) {
        const item = progress[detectedTask.eventName];
        return {
            value: safeNumber(item?.value),
            target: safeTarget(item, detectedTask.target),
        };
    }

    if (detectedTask?.name && progress[detectedTask.name]) {
        const item = progress[detectedTask.name];
        return {
            value: safeNumber(item?.value),
            target: safeTarget(item, detectedTask.target),
        };
    }

    let best = { value: 0, target: detectedTask?.target || 0 };
    for (const key of Object.keys(progress)) {
        const item = progress[key];
        if (!item) continue;
        const value = safeNumber(item.value);
        const target = safeTarget(item, detectedTask?.target || 0);
        if (value > best.value) {
            best = { value, target };
        }
    }
    return best;
}

export function readProgressForAction(quest, eventName, taskName) {
    const progress = quest.userStatus?.progress;
    if (!progress) return 0;

    let val = 0;
    if (eventName && progress[eventName]?.value != null) {
        val = progress[eventName].value;
    } else if (taskName && progress[taskName]?.value != null) {
        val = progress[taskName].value;
    } else {
        for (const k of Object.keys(progress)) {
            if (progress[k]?.value != null) {
                val = progress[k].value;
                break;
            }
        }
    }
    return Number(val) || 0;
}

export function safeTarget(item, fallback = 0) {
    const values = [item?.target, item?.total, item?.required, fallback];
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
}

export function safeNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return number;
}

export function getRewardInfo(quest) {
    const rewards = quest?.config?.rewards_config?.rewards;
    if (!Array.isArray(rewards) || rewards.length === 0) {
        return { name: 'Orbs', amount: 0 };
    }

    const reward = rewards[0];
    const amount = Number(reward?.orb_quantity);

    return {
        name: reward?.messages?.name || 'Orbs',
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    };
}

export function extractStatus(res) {
    if (res && typeof res === 'object' && res.user_status) {
        return res.user_status;
    }
    return res;
}

export function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return Number.isInteger(number) ? number.toLocaleString() : number.toFixed(1);
}

export function escapeMarkdown(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/([*_~`|>])/g, '\\$1');
}

export function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

