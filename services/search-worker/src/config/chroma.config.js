const {ChromaClient} = require ('chromadb');
const client = new ChromaClient({path: process.env.CHROMA_URL});
const COLLECTION_NAME = 'documents';

let collection;

async function initCollection() {
    try {
        collection = await client.getOrCreateCollection({
            name: COLLECTION_NAME,
            metadata: {'hnsw:space': 'cosine'},
        });
        console.log(`[ChromaDB] Collection "${COLLECTION_NAME}" ready`);
        return collection;
    } catch(err) {
        console.error(`[ChromaDB] Error to init collection: ${err.message}`);
        throw err;
    }
}

async function upsert({id, embedding, document, metadata}) {
    await collection.upsert({
        ids: [id],
        embeddings: [embedding],
        documents: [document],
        metadatas: [metadata],
    });
}

async function deleteById(id) {
    await collection.delete({ids: [id]});
}

async function deleteByWorkspace(workspaceId) {
    await collection.delete({where: {workspaceId}});
}

async function query({embedding, nResults=10, where}) {
    try {
        return await collection.query({
            queryEmbeddings: [embedding],
            nResults,
            where: where || undefined,
        }); 
    } catch(err) {
        if (err.message?.includes('no embeddings') || err.message?.includes('no documents')) {
            return {ids: [[]], embeddings: [[]], documents: [[]], metadatas: [[]]};
        }
        throw err;
    }
}

module.exports = { 
    initCollection, 
    upsert, 
    deleteById, 
    deleteByWorkspace, 
    query
};