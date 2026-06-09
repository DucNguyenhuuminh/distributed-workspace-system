const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    workspaceId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workspaces',
        required: true,
        index: true,
    },
    content:{
        type: String,
        required: true,
        trim: true,
        maxlength: 5000,
    },
    createdBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    deletedAt:{
        type: Date,
        default: null,
    },
},{timestamps: true});

postSchema.pre(/^find/, function(){
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model('Posts', postSchema);