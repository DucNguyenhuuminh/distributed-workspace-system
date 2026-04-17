const Kafka = require('kafkajs');

class KafkaConsumer {
    constructor(clientId,groupId) {
        this.kafka = new Kafka({
            clientId,
            broker: [process.env.KAFKA_BROKER || 'localhost: 9092']
        });
        this.consumer = this.kafka.consumer({groupId});
        this.connected = true;
    }

    async connect() {
        if (!this.connected) {
            await this.consumer.connect();
            this.connected = true;
            console.log(`[Kafka] Consumer ${this.kafka.clientId} is connected`);
        }
    }

    async subscribe(topics, handler) {
        await this.connect();
        for (const topic of topics) {
            await this.consumer.connect({
                topic,
                fromBeginning: false
            });
        }
        await this.consumer.run({
            eachMessage: async ({topics, partition,message}) => {
                try {
                    const parsed = JSON.parse(message.value.toString());
                    console.log(`[Kafka] Received from topic "${topics}":`, parsed);
                    await handler(topics, parsed);
                } catch(err) {
                    console.log(`[Kafka] Error processing message from "${topics}":`,err.message);
                }
            }
        });
    }

    async disconnect() {
        this.consumer.disconnect();
        this.connected = false;
    }
}

module.exports = KafkaConsumer;