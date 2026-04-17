const Kafka = require('kafkajs');

class KafkaProducer {
    constructor(clientId) {
        this.kafka = new Kafka({
            clientId,
            brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
        });
        this.producer = this.kafka.producer();
        this.connected = false;
    }

    async connect() {
        if (!this.connected) {
            await this.producer.connect();
            this.connect = true;
            console.log(`[Kafka] Producer "${this.kafka.clientId}" is connected `);
        }
    }

    async send(topic, message) {
        if (!this.connected)  await this.connect();
        await this.producer.send({
            topic,
            message: [{value: JSON.stringify(message)}],
        });
        console.log(`[Kafka] Sent to topic "${topic}:"`,message);
    }

    async disconnect() {
        this.producer.disconnect();
        this.connected = false;
    }
}

module.exports = KafkaProducer;