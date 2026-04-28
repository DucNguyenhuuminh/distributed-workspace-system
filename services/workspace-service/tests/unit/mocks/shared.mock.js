module.exports = {
  authMiddleware: (req, res, next) => {
    req.user = { userId: 'user-001' };
    next();
  },
  addJob:              jest.fn().mockResolvedValue(true),
  queueForEvent:       jest.fn((event) => `queue:${event}`),
  jobIdFor:            jest.fn((event, id) => `${event}:${id}`),
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  EVENTS: {
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
    MEMBER_ADDED:      'member.added',
    MEMBER_REMOVED:    'member.removed',
    FOLDER_CREATED:  'folder.created',
    FOLDER_RENAMED:  'folder.renamed',
    FOLDER_TRASHED:  'folder.trashed',
    FOLDER_RESTORED: 'folder.restored',
    FOLDER_MOVED:    'folder.moved',
  },
};