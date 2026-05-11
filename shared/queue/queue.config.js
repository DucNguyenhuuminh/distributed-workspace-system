const QUEUES ={
    FILE: 'file-queue',
    FOLDER: 'folder-queue',
    WORKSPACE: 'workspace-queue',
    NOTIFICATION: 'notification-queue',
    SEARCH: 'search-queue',
    GENERAL: 'general-queue'
};

const EVENTS = {
    FILE_UPLOAD: 'file.uploaded',
    FILE_MERGED: 'file.merged',
    FILE_RENAMED: 'file.renamed',
    FILE_TRASHED: 'file.trashed',
    FILE_RESTORED: 'file.restored',
    FILE_MOVED: 'file.moved',

    FOLDER_CREATED: 'folder.created',
    FOLDER_RENAMED: 'folder.renamed',
    FOLDER_TRASHED: 'folder.trashed',
    FOLDER_RESTORED: 'folder.restored',
    FOLDER_MOVED: 'folder.moved',

    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
    MEMBER_ADDED: 'member.added',
    MEMBER_REMOVED: 'member.removed',
    MEMBER_PERMISSION: 'member.permission',

    USER_REGISTERED: 'user.registered',
    NOTIFY_USER: 'notification.send'
};

const EVENT_QUEUE_MAP = {
    [EVENTS.FILE_UPLOAD]: QUEUES.FILE,
    [EVENTS.FILE_MERGED]: QUEUES.FILE,
    [EVENTS.FILE_RENAMED]: QUEUES.FILE,
    [EVENTS.FILE_TRASHED]: QUEUES.FILE,
    [EVENTS.FILE_RESTORED]: QUEUES.FILE,
    [EVENTS.FILE_MOVED]: QUEUES.FILE,

    [EVENTS.FOLDER_CREATED]: QUEUES.FOLDER,
    [EVENTS.FOLDER_RENAMED]: QUEUES.FOLDER,
    [EVENTS.FOLDER_TRASHED]: QUEUES.FOLDER,
    [EVENTS.FOLDER_RESTORED]: QUEUES.FOLDER,
    [EVENTS.FOLDER_MOVED]: QUEUES.FOLDER,

    [EVENTS.WORKSPACE_CREATED]: QUEUES.WORKSPACE,
    [EVENTS.WORKSPACE_DELETED]: QUEUES.WORKSPACE,
    [EVENTS.MEMBER_ADDED]: QUEUES.WORKSPACE,
    [EVENTS.MEMBER_REMOVED]: QUEUES.WORKSPACE,
    [EVENTS.MEMBER_PERMISSION]: QUEUES.WORKSPACE,

    [EVENTS.USER_REGISTERED]: QUEUES.GENERAL,
    [EVENTS.NOTIFY_USER]: QUEUES.NOTIFICATION,
};

const DEFAULT_JOB_OPTIONS = {
    attemps: 5,
    backoff: {type: 'exponential', delay: 2000},
    removeOnComplete: {age: 3600},
    removeOnFail: {age: 86400},
};

function queueForEvent(event) {
    return EVENT_QUEUE_MAP[event] || QUEUES.GENERAL;
}

function jobIdFor(event, entityId) {
    const safeEvent = event.replace(/\./g, '_').replace(/:/g, '_');
    return entityId 
        ? `${safeEvent}_${String(entityId)}`
        : `${safeEvent}_${Date.now()}`;
}

module.exports = {
    QUEUES,
    EVENTS,
    EVENT_QUEUE_MAP,
    DEFAULT_JOB_OPTIONS,
    queueForEvent,
    jobIdFor
};