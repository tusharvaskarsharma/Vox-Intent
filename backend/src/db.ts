import { MongoClient, Collection } from 'mongodb';

export interface Contact {
  name: string;
  walletAddress: string;
  label?: string;
}

let client: MongoClient | null = null;
let contactsCollection: Collection<Contact> | null = null;

export async function connectDB(uri: string) {
  if (client) return;
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db('voxintent');
  contactsCollection = db.collection<Contact>('contacts');
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    contactsCollection = null;
  }
}

export function getContactsCollection(): Collection<Contact> {
  if (!contactsCollection) throw new Error('Database not connected');
  return contactsCollection;
}
