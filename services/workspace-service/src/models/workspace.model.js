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
            type: [{
                type: [],
                enum: ["preview", "download", "upload"]
            }],
            default: ["preview"],
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
            default: null,
        },
        members: [memberSchema],
        deletedAt:{
            type: Date,
            default: null,
        },
    },
    {timestamps: true}
);

workspaceSchema.pre(/^find/, function() {
    if (!this.getOptions()._recursed) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model("Workspaces", workspaceSchema);