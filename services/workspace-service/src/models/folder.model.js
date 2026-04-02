const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema(
    {
        name:{
            type: String,
            required: true,
            trim: true,
        },
        workspaceId:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        ownerId:{
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        parentId:{
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        createdBy:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        deletedAt:{
            type: Date,
            default: null,
        },
    },
    {timestamp: true}
);

folderSchema.pre(/^find/,function() {
    if (!this.getOptions()._recursed) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model("Folders",folderSchema);