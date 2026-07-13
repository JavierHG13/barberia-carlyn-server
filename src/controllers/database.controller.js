import {
    getAllTables,
    getTableData,
    getSequences,
    executeTransaction,
    getDatabaseSize,
    getTableCount,
    getConnections,
    runCustomQuery
} from '../models/database.model.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);


export const getStats = async (req, res) => {
    try {
        const stats = {};

        const size = await getDatabaseSize();
        stats.database_size = size.rows[0].size;

        const tables = ['usuarios', 'barberos', 'tbl_servicios', 'tbl_productos'];

        for (const table of tables) {
            const result = await getTableCount(table);
            stats[`${table}_count`] = parseInt(result.rows[0].count);
        }

        const connections = await getConnections();
        stats.connections = connections.rows[0];

        res.json({ estadisticas: stats });

    } catch (error) {

        res.status(500).json({ error: error.message });
    }
};