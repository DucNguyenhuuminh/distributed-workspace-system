const mongoose = require('mongoose');
const {EVENTS} = require('shared');
const eventValues = Object.values(EVENTS);

const notiSchema = new mongoose.Schema({
    userId: {
      type:     String,
      required: true,
      index:    true,
    },
    actorId: {
        type: String,
        required:true,
        default: null,
    },
    type: {
      type: String,
      enum: eventValues,
      required: true,
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