const cron = require('node-cron');
const Document = require('./models/documents.model');
const PhysicalFile = require('./models/physical-file.model');
const axios = require('axios');

cron.schedule('0 2 * * *', async () => {
    console.log('[Cleanup worker] Start cleaning trash............');
    const tenDaysAgo = new Date() - 10*60*60*24*1000;

    try {
        const expiredDocs = await Document.find({
            deletedAt: {$lt: tenDaysAgo}
        });
        for (const doc of expiredDocs) {
            const physId = doc.physicalFileId;
            const otherDocs = await Document.findOne({
                physicalFileId: physId,
                _id: { $ne: doc._id },
                deletedAt: null
            });

            if (!otherDocs) {
                const physFile = await PhysicalFile.findById(physId);
                if (physFile) {
                    await axios.delete(`${process.env.STORAGE_SERVICE_URL}/api/storage/file`, {
                        data: { objectName: physFile.minioObjectPath }
                    });
                    await PhysicalFile.findByIdAndDelete(physId);
                }
            }

            await Document.findByIdAndDelete(doc._id);
        }
        console.log(`[Cleanup worker] Cleaned ${expiredDocs.length} file.`);
    } catch(err) {
        console.error('[Cleanup worker] Error:', err.message);
    }
});