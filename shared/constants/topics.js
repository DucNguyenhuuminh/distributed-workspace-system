module.exports = {
    TOPICS: {
        FILE_EVENTS: 'file-events',
        FOLDER_EVENTS: 'folder-events',
        WORKSPACE_EVENTS: 'workspace-events',
        AUTH_EVENTS: 'auth-events'
    },

    EVENTS: {
        FILE_UPLOADED: 'file.uploaded',
        FILE_RENAMED: 'file.renamed',
        FILE_TRASHED: 'file.trashed',
        FILE_RESTORED: 'file.restored',
        FILE_DELETED: 'file.deleted',

        FOLDER_CREATED: 'folder.created',
        FOLDER_RENAMED: 'folder.renamed',
        FOLDER_TRASHED: 'folder.trashed',
        FOLDER_RESTORED: 'folder.restored',
        FOLDER_DETELED: 'folder.deleted',

        WORKSPACE_CREATED: 'workspace.created',
        WORKSPACE_DELETED: 'workspace.deleted',
        MEMBER_ADDED: 'workspace.member_added',
        MEMBER_REMOVED: 'workspace.member_removed',
        ROLE_UPDATED: 'workspace.role_updated',

        USER_REGISTERED: 'user.registered',
    }
}