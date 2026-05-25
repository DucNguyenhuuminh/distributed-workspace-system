const mongoose = require('mongoose');
const crypto = require('crypto');

const workspaceInviteSchema = new mongoose.Schema(
    {
        workspaceId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        createdBy:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        token:{
            type: String,
            required: true,
            unique: true,
            index: true,
            default: () => crypto.randomBytes(32).toString('hex'),
        },
        expiredAt:{
            type: Date,
            default: false,
        },
        isRevoked:{
            type: Boolean,
            default: null,
        },
        autoApprove:{
            type: Boolean,
            default: false,
        },
        workspaceName:{
            type: String,
            default: null,
        },
    },{timestamps: true}
);

workspaceInviteSchema.index(
    {expiredAt: 1},
    {expireAfterSeconds: 30*24*3600,sparse: true}
);

module.exports = mongoose.model('WorkspaceInvites', workspaceInviteSchema);