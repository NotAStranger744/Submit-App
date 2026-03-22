const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const swaggerUi = require('swagger-ui-express');


const app = express();
const port = 3001;

app.use(cors());
app.use(express.static('public')); 
app.use(express.json());


//connect to sql database
const pool = mysql.createPool({
    host: 'db',
    user: 'root',
    password: 'DistSystemsPassword', //password for mysql will need altering to run a db on a different machine
    database: 'joke_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


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


app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));


//find joke categories from db
app.get('/types', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM types');
        res.json(rows);
    } catch (error) {
        console.error("Error fetching types:", error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

//post joke to db
app.post('/submit', async (req, res) => {
    const { setup, punchline, type } = req.body;

    //validation
    if (!setup || !punchline || !type) {
        return res.status(400).json({ error: 'Setup, punchline, and type are required' });
    }

    try {
        //add the type if it doesnt exist already 
        await pool.query('INSERT IGNORE INTO types (name) VALUES (?)', [type]); //makes sure duplicate types arent added

        //fetch the ID of the (new) type
        const [typeRows] = await pool.query('SELECT id FROM types WHERE name = ?', [type]);
        
        if (typeRows.length === 0) {
            return res.status(500).json({ error: 'Failed to retrieve type ID' });
        }
        
        const typeId = typeRows[0].id;

        //insert the new joke with the type id
        await pool.query(
            'INSERT INTO jokes (type_id, setup, punchline) VALUES (?, ?, ?)',
            [typeId, setup, punchline]
        );

        res.status(201).json({ message: 'Joke submitted successfully!' });

    } catch (error) { //error handling
        console.error("Error submitting joke:", error);
        res.status(500).json({ error: 'Failed to save joke to database' });
    }
});

app.listen(port, () => {
    console.log(`Submit App listening at http://localhost:${port}`);
    console.log(`Swagger Docs available at http://localhost:${port}/docs`);
});