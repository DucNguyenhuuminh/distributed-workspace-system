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
            default: null,
            index: true,
        },
        parentId:{
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true,
        },
        createdBy:{
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        deletedAt:{
            type: Date,
            default: null,
            index: true,
        },
    },
    {timestamps: true}
);

folderSchema.pre(/^find/,function() {
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model("Folders",folderSchema);