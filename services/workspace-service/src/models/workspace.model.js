const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
    {
        userId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        role:{
            type: String,
            enum: ["MEMBER", "ADMIN"],
            default: "MEMBER",
        },
        permissions:{
            type: String,
            enum: ['viewer', 'editor'],
            default: 'viewer',
        },
    }, {_id: false});

const workspaceSchema = new mongoose.Schema(
    {
        name:{
            type: String,
            required: true,
            trim: true,
        },
        createdBy:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        members: [memberSchema],
        deletedAt:{
            type: Date,
            default: null,
            index: true,
        },
    },
    {timestamps: true}
);

workspaceSchema.pre(/^find/, function() {
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model("Workspaces", workspaceSchema);