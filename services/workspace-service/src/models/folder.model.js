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
    },
    {timestamp: true}
);

module.exports = mongoose.model("Folders",folderSchema);