import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';

// Some Windows/router DNS setups refuse the SRV lookup that mongodb+srv:// needs; DNS_SERVERS overrides them.
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`MongoDB connected (${mongoose.connection.name})`);
}
