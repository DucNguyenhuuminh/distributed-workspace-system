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
            enum: ["preview", "download"],
            default: "preview",
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
    },
    {timestamps: true}
);

module.exports = mongoose.model("Workspaces", workspaceSchema);