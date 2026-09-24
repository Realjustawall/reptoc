import { supabase } from "./postgres";
import bcrypt from "bcryptjs";
import { isUsernameUnavailable, validateUsername } from "./utils/usernames";

async function setupAdmin() {
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const email = process.env.INITIAL_ADMIN_EMAIL || username;
  if (!username || !password || password.length < 16) {
    throw new Error("INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD with at least 16 characters are required.");
  }
  const validation = validateUsername(username);
  if (validation.ok === false) throw new Error(validation.error);
  
  const hashedPassword = await bcrypt.hash(password, 12);
  const userId = "admin-" + Date.now();

  const { data: existing } = await supabase.from('users').select('id, username, email').ilike('username', username).single();
  
  if (existing) {
    const { error } = await supabase.from('users').update({
      password: hashedPassword,
      role: 'owner',
      email: email
    }).eq('id', existing.id);
    if (error) console.error("Error updating admin user:", error);
    else console.log("Admin user updated successfully.");
  } else {
    if (await isUsernameUnavailable(username)) {
      throw new Error("The requested initial admin username is already reserved.");
    }
    const { error } = await supabase.from('users').insert({
      id: userId,
      username: username,
      email: email,
      password: hashedPassword,
      role: 'owner',
      level: 99,
      xp: 9999,
      coins: 99999,
      streak: 100,
      avatar: 'OF'
    });
    if (error) console.error("Error creating admin user:", error);
    else console.log("Admin user created successfully.");
  }
}

setupAdmin();
