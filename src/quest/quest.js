export class Quest {
    #data;

    constructor(data) {
        this.#data = data;
    }

    static create(data) {
        return new Quest(data);
    }

    get id() { return this.#data.id; }
    get config() { return this.#data.config; }
    get userStatus() { return this.#data.user_status; }
    get targetedContent() { return this.#data.targeted_content; }
    get preview() { return this.#data.preview; }

    isExpired(reference = new Date()) {
        return reference.getTime() > new Date(this.#data.config.expires_at).getTime();
    }

    isCompleted() {
        return Boolean(this.userStatus?.completed_at);
    }

    isEnrolledQuest() {
        return Boolean(this.userStatus?.enrolled_at);
    }

    hasClaimedRewards() {
        return Boolean(this.userStatus?.claimed_at);
    }

    updateUserStatus(userStatus) {
        this.#data.user_status = userStatus;
    }

    // Yeh method check karega ki quest ke andar valid aur supported tasks maujud hain ya nahi
    isValidQuest() {
        const tasks = (this.#data.config?.task_config ?? this.#data.config?.task_config_v2)?.tasks;
        if (!tasks) return false;
        
        const supportedTypes = [
            'PLAY_ON_DESKTOP',
            'WATCH_VIDEO',
            'STREAM_ON_DESKTOP',
            'PLAY_ACTIVITY',
            'WATCH_VIDEO_ON_MOBILE',
            'LEARN_MORE',
            'WATCH_VIDEO_EMBED'
        ];

        return Object.keys(tasks).some(type => supportedTypes.includes(type));
    }
}
