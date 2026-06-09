const mongoose = require('mongoose');

const postCommentSchema = new mongoose.Schema({
    postId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Posts',
        required: true,
        index: true
    },
    content:{
        type: String,
        required: true,
        trim: true,
        maxLength: 2000,
    },
    createdBy:{
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    parentId:{
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    deletedAt:{
        type: Date,
        default: null,
    },
},{timestamps: true});

postCommentSchema.pre(/^find/, function(){
    if (!this.getOptions().includeDeleted) {
        this.where({deletedAt: null});
    }
});

module.exports = mongoose.model('PostComments', postCommentSchema);