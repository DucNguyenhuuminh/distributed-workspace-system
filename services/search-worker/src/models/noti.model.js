const mongoose = require('mongoose');
const {EVENTS} = require('shared');
const eventValues = [
  // File
  'FILE_MERGED',
  'FILE_RESTORED',
  // Workspace
  'WORKSPACE_CREATED',
  'WORKSPACE_DELETED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MEMBER_PERMISSION',
  // Folder
  'FOLDER_RESTORED',
  // User
  'USER_REGISTERED',
  // General
  'GENERAL',
];

const notiSchema = new mongoose.Schema({
    userId: {
      type:     String,
      required: true,
      index:    true,
    },
    actorId: {
        type: String,
        default: null,
    },
    type: {
      type: String,
      enum: eventValues,
      default: 'GENERAL'
    },
    title: {
      type:     String,
      required: true,
    },
    message: {
      type:     String,
      required: true,
    },
    actionUrl: {
        type: String,
        default: null,
    },
    metadata: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type:    Boolean,
      default: false,
      index:   true,
    },
  }, { timestamps: true });

notiSchema.index({userId: 1, isRead: 1, createdAt: -1});

module.exports = mongoose.model('Notifications', notiSchema);