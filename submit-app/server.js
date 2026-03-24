const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const fs = require('fs/promises');
const path = require('path');
const swaggerUi = require('swagger-ui-express');


const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.use('/submit', express.static('public'));
app.get('/submit', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//env variables for vm communication
const JOKE_SERVICE_URL = process.env.JOKE_SERVICE_URL || 'http://localhost:3000';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq'; 
const QUEUE_NAME = 'joke_queue';

//the cache file for resilience
const CACHE_FILE = '/data/cache/types_cache.json';

//rabbit mq setup for async communication with the joke service
let rabbitChannel = null;

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        rabbitChannel = await connection.createChannel();
        //Ensure queue is durable (survives restarts)
        await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });
        console.log("Connected to RabbitMQ.");
    } catch (error) {
        console.error("Failed to connect to RabbitMQ, retrying...", error);
        setTimeout(connectRabbitMQ, 5000);
    }
}
connectRabbitMQ();


//swagger setup
//very good for docs and function testing
const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'Submit Application API',
        version: '1.0.0',
        description: 'API for submitting new jokes and retrieving joke types.'
    },
    paths: {
        '/types': {
            get: {
                summary: 'Retrieves a list of all joke types',
                responses: { 
                    '200': { description: 'Successful operation' },
                    '500': { description: 'Database connection failed' }
                }
            }
        },
        '/submit': {
            post: {
                summary: 'Submit a new joke',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    setup: { type: 'string' },
                                    punchline: { type: 'string' },
                                    type: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: { 
                    '201': { description: 'Joke submitted successfully' },
                    '400': { description: 'Setup, punchline, and type are required' },
                    '500': { description: 'Failed to retrieve type ID or save joke to database' }
                }
            }
        },
        '/docs': {
            get: {
                summary: 'API documentation (This Page)',
                responses: { '200': { description: 'API documentation' } }
            }
        }
    }
};


app.use('/submit/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

//find joke categories from joke service, cache it, or fallback to cache
app.get('/types', async (req, res) => {
    try {
        //attempt to fetch from vm 1
        const response = await fetch(`${JOKE_SERVICE_URL}/types`);
        
        if (!response.ok) throw new Error("Failed to fetch from Joke Service");
        
        const types = await response.json();

        //cache the result to file
        await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(types));

        //return the updated data
        res.json(types);

    } catch (error) {
        console.warn("Joke service unreachable. Falling back to cache...", error.message);
        
        try {
            //read from the cached file as last resort
            const cachedData = await fs.readFile(CACHE_FILE, 'utf-8');
            res.json(JSON.parse(cachedData));
        } catch (cacheError) {
            console.error("Cache read failed:", cacheError);
            res.status(503).json({ error: 'Service unavailable and no cache found.' });
        }
    }
});

//post joke to rabbit mq
app.post('/submit', async (req, res) => {
    const { setup, punchline, type } = req.body;

    //validation
    if (!setup || !punchline || !type) {
        return res.status(400).json({ error: 'Setup, punchline, and type are required' });
    }

    if (!rabbitChannel) {
        return res.status(503).json({ error: 'RabbitMQ is currently unavailable' });
    }

    try {
        const jokePayload = JSON.stringify({ setup, punchline, type });
        
        //push to queue
        rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(jokePayload), {
            persistent: true 
        });

        res.status(202).json({ message: 'Joke accepted and queued' });
    } catch (error) {
        console.error("Failed to queue joke:", error);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

app.listen(port, () => {
    console.log(`Submit App listening at Port ${port}`);
    console.log(`Swagger Docs available at /docs`);
    console.log(`Joke Service URL: ${JOKE_SERVICE_URL}`);
});