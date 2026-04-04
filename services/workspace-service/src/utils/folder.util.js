const Folder = require('../models/folder.model');

async function getBreadcrumbPath(folderId) {
    const breadcrumb = [];
    let currentId = folderId;

    while(currentId) {
        const folder = await Folder.findById(currentId);
        if (!folder)  break;

        breadcrumb.unshift({
            _id: folder._id,
            name: folder.name,
            parentId: folder.parentId
        });
        currentId = folder.parentId;
    }
    return breadcrumb;
}

// Using for delete
async function getAllDescendantIds(rootFolderId) {
    let descendantIds = [];
    let queue = [rootFolderId];

    while(queue.length > 0) {
        const children = await Folder.find({parentId: {$in: queue}},'_id');
        const childIds = children.map(c => c._id);

        if (childIds.length > 0) {
            descendantIds = descendantIds.concat(childIds);
            queue = childIds;
        }else {
            queue = [];
        }
    }
    return descendantIds;
}

async function isCircularMove(sourceFolderId, targetParentId) {
    let currentParentId = targetParentId;
    let depth = 0;

    while(currentParentId) {
        if (currentParentId.toString() === sourceFolderId.toString()) {
            return true;
        }
        const parentNode = await Folder.findById(currentParentId,'parentId');
        currentParentId = parentNode ? parentNode.parentId : null;
        depth++;
        if (depth > 100) {
            throw new Error("System Error: Tree depth exceeded");
        }
    }
    return false;
}

module.exports = {getBreadcrumbPath, getAllDescendantIds, isCircularMove};