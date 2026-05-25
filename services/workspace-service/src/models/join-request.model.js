const mongoose = require('mongoose');

const joinRequestSchema = new mongoose.Schema(
    {
        workspaceId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        userId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        inviteToken:{
            type: String,
            required: true,
        },
        status:{
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
            index: true,
        },
        reviewedAt:{
            type: Date,
            default: null,
        },
        message:{
            type: String,
            default: null,
        },
        userEmail:{
            type: String,
            default: null,
        },
        userName:{
            type: String,
            default: null,
        },
    },{timestamps: true}
);

joinRequestSchema.index(
    {workspaceId: 1, userId: 1},
    {unique: true}
);

module.exports = mongoose.model('JoinRequest',joinRequestSchema);