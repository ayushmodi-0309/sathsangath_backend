/**
 * Adds 50 random APPROVED members (mix of male/female) to the live database.
 * Safe to re-run: members whose phone already exists are skipped.
 * Member login password: "Demo@1234"
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { nextProfileCode } from "../src/lib/util";

const PASSWORD = "Demo@1234";

type M = {
  name: string;
  gender: "MALE" | "FEMALE";
  phone: string;
  age: number;
  heightCm: number;
  marital: string;
  community: string;
  sub?: string;
  city: string;
  state: string;
  native: string;
  tongue: string;
  family: string;
  education: string;
  profession: string;
  income: string;
  diet: string;
  father: string;
  mother: string;
  siblings: string;
  about: string;
  prefAge: [number, number];
  prefHeight?: number;
  prefMarital?: string;
  relocate?: string;
};

const MEMBERS: M[] = [
  // --- MALES ---
  { name: "Arjun Sharma", gender: "MALE", phone: "9100000001", age: 28, heightCm: 176, marital: "Never married", community: "Brahmin", sub: "Saraswat", city: "Ahmedabad", state: "Gujarat", native: "Mehsana", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹15–20 lakh", diet: "Vegetarian", father: "Government officer", mother: "Homemaker", siblings: "1 sister", about: "Software engineer at a multinational firm. Enjoys hiking and chess.", prefAge: [23, 28], prefHeight: 155, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Vivek Patel", gender: "MALE", phone: "9100000002", age: 31, heightCm: 173, marital: "Never married", community: "Patel", sub: "Kadva", city: "Surat", state: "Gujarat", native: "Bardoli", tongue: "Gujarati", family: "Joint", education: "Professional", profession: "Business", income: "₹20–30 lakh", diet: "Vegetarian", father: "Businessman", mother: "Homemaker", siblings: "1 brother", about: "Manages a textile export business. Looking for a grounded, family-oriented partner.", prefAge: [24, 30], prefMarital: "Never married", relocate: "No" },
  { name: "Nikhil Joshi", gender: "MALE", phone: "9100000003", age: 26, heightCm: 180, marital: "Never married", community: "Brahmin", sub: "Audichya", city: "Vadodara", state: "Gujarat", native: "Anand", tongue: "Gujarati", family: "Nuclear", education: "Post Graduate", profession: "Doctor", income: "₹30–50 lakh", diet: "Vegetarian", father: "Professor", mother: "Doctor", siblings: "None", about: "Resident doctor. Passionate about medicine and travelling.", prefAge: [22, 27], prefHeight: 157, prefMarital: "Never married", relocate: "Yes" },
  { name: "Ravi Agarwal", gender: "MALE", phone: "9100000004", age: 34, heightCm: 170, marital: "Divorced", community: "Marwari", sub: "Agarwal", city: "Mumbai", state: "Maharashtra", native: "Jaipur", tongue: "Hindi", family: "Nuclear", education: "Post Graduate", profession: "Service", income: "₹20–30 lakh", diet: "Vegetarian", father: "Retired banker", mother: "Homemaker", siblings: "2 sisters", about: "Senior manager at a bank. Values honesty and a peaceful home life.", prefAge: [27, 34], prefMarital: "Any", relocate: "Maybe" },
  { name: "Kartik Mehta", gender: "MALE", phone: "9100000005", age: 29, heightCm: 175, marital: "Never married", community: "Gujarati", sub: "Lohana", city: "Rajkot", state: "Gujarat", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹10–15 lakh", diet: "Vegetarian", father: "Retired teacher", mother: "Homemaker", siblings: "1 brother", about: "Works in logistics. Family-oriented and enjoys cooking.", prefAge: [23, 28], relocate: "No" },
  { name: "Siddharth Trivedi", gender: "MALE", phone: "9100000006", age: 27, heightCm: 178, marital: "Never married", community: "Brahmin", sub: "Nagar", city: "Ahmedabad", state: "Gujarat", native: "Gandhinagar", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹12–15 lakh", diet: "Vegetarian", father: "Accountant", mother: "Teacher", siblings: "1 sister", about: "Backend developer. Loves reading and badminton.", prefAge: [22, 27], prefHeight: 155, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Manav Kapoor", gender: "MALE", phone: "9100000007", age: 32, heightCm: 172, marital: "Never married", community: "Gujarati", sub: "Punjabi", city: "Mumbai", state: "Maharashtra", native: "Delhi", tongue: "Hindi", family: "Nuclear", education: "Professional", profession: "Chartered Accountant", income: "₹25–35 lakh", diet: "Eggetarian", father: "Businessman", mother: "Homemaker", siblings: "1 brother", about: "Practising CA with an established firm. Values a balanced family life.", prefAge: [26, 31], prefHeight: 158, prefMarital: "Never married", relocate: "No" },
  { name: "Tejas Shah", gender: "MALE", phone: "9100000008", age: 24, heightCm: 169, marital: "Never married", community: "Gujarati", sub: "Shrimali", city: "Surat", state: "Gujarat", native: "Surat", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹7–10 lakh", diet: "Vegetarian", father: "Diamond trader", mother: "Homemaker", siblings: "1 sister", about: "Runs a small jewellery shop. Simple, sincere, and devoted to family.", prefAge: [21, 26], relocate: "No" },
  { name: "Ronak Desai", gender: "MALE", phone: "9100000009", age: 30, heightCm: 174, marital: "Never married", community: "Patel", sub: "Leuva", city: "Ahmedabad", state: "Gujarat", native: "Anand", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹18–22 lakh", diet: "Vegetarian", father: "Farmer", mother: "Homemaker", siblings: "2 brothers", about: "Civil engineer with a government firm. Reliable and hardworking.", prefAge: [24, 29], prefHeight: 157, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Param Jain", gender: "MALE", phone: "9100000010", age: 35, heightCm: 168, marital: "Widowed", community: "Jain", sub: "Digambar", city: "Mumbai", state: "Maharashtra", native: "Nagpur", tongue: "Hindi", family: "Joint", education: "Post Graduate", profession: "Business", income: "₹30–50 lakh", diet: "Jain", father: "Retired judge", mother: "Homemaker", siblings: "1 sister", about: "Owns a pharmaceutical distribution company. Looking for a compassionate partner.", prefAge: [28, 35], prefMarital: "Any", relocate: "Maybe" },
  { name: "Dhruv Thakkar", gender: "MALE", phone: "9100000011", age: 26, heightCm: 177, marital: "Never married", community: "Patel", sub: "Kadva", city: "Ahmedabad", state: "Gujarat", native: "Mehsana", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Service", income: "₹10–15 lakh", diet: "Vegetarian", father: "Retired army officer", mother: "Homemaker", siblings: "1 sister", about: "IT analyst. Enjoys cycling and photography.", prefAge: [22, 27], prefHeight: 155, prefMarital: "Never married", relocate: "Yes" },
  { name: "Harsh Rajput", gender: "MALE", phone: "9100000012", age: 29, heightCm: 181, marital: "Never married", community: "Gujarati", sub: "Rajput", city: "Vadodara", state: "Gujarat", native: "Vadodara", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹15–20 lakh", diet: "Non-vegetarian", father: "Politician", mother: "Homemaker", siblings: "2 brothers", about: "Manages a chain of grocery stores. Active, social, family-oriented.", prefAge: [23, 28], relocate: "No" },
  { name: "Parth Malhotra", gender: "MALE", phone: "9100000013", age: 28, heightCm: 174, marital: "Never married", community: "Gujarati", sub: "Punjabi", city: "Surat", state: "Gujarat", native: "Chandigarh", tongue: "Punjabi", family: "Nuclear", education: "Post Graduate", profession: "Engineer", income: "₹12–18 lakh", diet: "Eggetarian", father: "Engineer", mother: "Teacher", siblings: "1 sister", about: "Product manager at a tech startup. Enjoys music and long drives.", prefAge: [24, 29], prefHeight: 157, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Yash Vora", gender: "MALE", phone: "9100000014", age: 33, heightCm: 170, marital: "Divorced", community: "Jain", sub: "Shwetambar", city: "Rajkot", state: "Gujarat", native: "Morbi", tongue: "Gujarati", family: "Nuclear", education: "Professional", profession: "Chartered Accountant", income: "₹20–25 lakh", diet: "Jain", father: "Jeweller", mother: "Homemaker", siblings: "1 brother", about: "CA with 8 years of experience. Looking for a mature, understanding partner.", prefAge: [26, 33], prefMarital: "Any", relocate: "Maybe" },
  { name: "Aakash Rana", gender: "MALE", phone: "9100000015", age: 27, heightCm: 179, marital: "Never married", community: "Gujarati", sub: "Rajput", city: "Ahmedabad", state: "Gujarat", native: "Patan", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹8–12 lakh", diet: "Vegetarian", father: "Police officer", mother: "Homemaker", siblings: "1 brother", about: "Bank clerk. Responsible, homely, and fond of cricket.", prefAge: [22, 27], relocate: "No" },
  { name: "Neel Pandya", gender: "MALE", phone: "9100000016", age: 31, heightCm: 172, marital: "Never married", community: "Brahmin", sub: "Saraswat", city: "Mumbai", state: "Maharashtra", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Professional", profession: "Doctor", income: "₹30–50 lakh", diet: "Vegetarian", father: "Doctor", mother: "Doctor", siblings: "1 sister", about: "Orthopaedic surgeon. Patient, caring, and deeply family-oriented.", prefAge: [25, 30], prefHeight: 160, prefMarital: "Never married", relocate: "Yes" },
  { name: "Dev Choksi", gender: "MALE", phone: "9100000017", age: 25, heightCm: 167, marital: "Never married", community: "Jain", sub: "Oswal", city: "Ahmedabad", state: "Gujarat", native: "Ahmedabad", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Business", income: "₹8–12 lakh", diet: "Jain", father: "CA", mother: "Homemaker", siblings: "1 brother", about: "Handles family textile business. Hardworking and values tradition.", prefAge: [21, 26], prefMarital: "Never married", relocate: "No" },
  { name: "Kush Trivedi", gender: "MALE", phone: "9100000018", age: 30, heightCm: 176, marital: "Never married", community: "Brahmin", sub: "Nagar", city: "Surat", state: "Gujarat", native: "Surat", tongue: "Gujarati", family: "Nuclear", education: "Post Graduate", profession: "Service", income: "₹15–20 lakh", diet: "Vegetarian", father: "Retired professor", mother: "Teacher", siblings: "1 sister", about: "Data analyst. Thoughtful, calm, and enjoys gardening.", prefAge: [24, 29], prefHeight: 157, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Raj Bhatt", gender: "MALE", phone: "9100000019", age: 28, heightCm: 173, marital: "Never married", community: "Brahmin", sub: "Audichya", city: "Vadodara", state: "Gujarat", native: "Vadodara", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹12–15 lakh", diet: "Vegetarian", father: "Engineer", mother: "Homemaker", siblings: "2 sisters", about: "Mechanical engineer in a manufacturing firm. Honest and hard-working.", prefAge: [23, 28], relocate: "Maybe" },
  { name: "Manan Shah", gender: "MALE", phone: "9100000020", age: 26, heightCm: 171, marital: "Never married", community: "Gujarati", sub: "Shrimali", city: "Ahmedabad", state: "Gujarat", native: "Bhavnagar", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹7–10 lakh", diet: "Vegetarian", father: "Retired teacher", mother: "Homemaker", siblings: "1 sister", about: "Runs a printing business. Social, family-oriented, and loves cricket.", prefAge: [21, 26], relocate: "No" },
  { name: "Shivam Raval", gender: "MALE", phone: "9100000021", age: 32, heightCm: 178, marital: "Never married", community: "Gujarati", sub: "Lohana", city: "Mumbai", state: "Maharashtra", native: "Surat", tongue: "Gujarati", family: "Nuclear", education: "Professional", profession: "Service", income: "₹25–35 lakh", diet: "Eggetarian", father: "Businessman", mother: "Homemaker", siblings: "None", about: "Finance manager. Pragmatic, well-read, and values quality time with family.", prefAge: [26, 31], prefHeight: 158, prefMarital: "Never married", relocate: "No" },
  { name: "Priyank Modi", gender: "MALE", phone: "9100000022", age: 29, heightCm: 175, marital: "Never married", community: "Patel", sub: "Leuva", city: "Ahmedabad", state: "Gujarat", native: "Ankleshwar", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹15–20 lakh", diet: "Vegetarian", father: "Chemical engineer", mother: "Homemaker", siblings: "1 brother", about: "Process engineer at a petrochemical plant. Disciplined and goal-oriented.", prefAge: [24, 28], prefHeight: 157, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Jeet Parmar", gender: "MALE", phone: "9100000023", age: 24, heightCm: 170, marital: "Never married", community: "Patel", sub: "Kadva", city: "Surat", state: "Gujarat", native: "Surat", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹5–8 lakh", diet: "Vegetarian", father: "Diamond trader", mother: "Homemaker", siblings: "2 brothers", about: "Works in family diamond business. Simple, sincere, and devoted to family.", prefAge: [21, 25], relocate: "No" },
  { name: "Vraj Kothari", gender: "MALE", phone: "9100000024", age: 27, heightCm: 177, marital: "Never married", community: "Jain", sub: "Oswal", city: "Rajkot", state: "Gujarat", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Business", income: "₹10–15 lakh", diet: "Jain", father: "Jeweller", mother: "Homemaker", siblings: "1 sister", about: "Manages family jewellery business. Traditional values with modern outlook.", prefAge: [22, 27], prefMarital: "Never married", relocate: "No" },
  { name: "Sagar Prajapati", gender: "MALE", phone: "9100000025", age: 30, heightCm: 169, marital: "Never married", community: "Gujarati", sub: "Prajapati", city: "Ahmedabad", state: "Gujarat", native: "Nadiad", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹8–12 lakh", diet: "Vegetarian", father: "Farmer", mother: "Homemaker", siblings: "1 brother", about: "Government employee. Honest, responsible, and values family traditions.", prefAge: [24, 29], relocate: "No" },

  // --- FEMALES ---
  { name: "Priya Sharma", gender: "FEMALE", phone: "9100000026", age: 25, heightCm: 160, marital: "Never married", community: "Brahmin", sub: "Saraswat", city: "Ahmedabad", state: "Gujarat", native: "Mehsana", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹10–15 lakh", diet: "Vegetarian", father: "Government officer", mother: "Teacher", siblings: "1 brother", about: "Software developer. Loves painting and classical dance.", prefAge: [27, 32], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Kavya Patel", gender: "FEMALE", phone: "9100000027", age: 23, heightCm: 157, marital: "Never married", community: "Patel", sub: "Leuva", city: "Surat", state: "Gujarat", native: "Navsari", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹5–7 lakh", diet: "Vegetarian", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "HR executive at a private firm. Cheerful and family-oriented.", prefAge: [25, 30], prefHeight: 168, prefMarital: "Never married", relocate: "No" },
  { name: "Riya Joshi", gender: "FEMALE", phone: "9100000028", age: 27, heightCm: 163, marital: "Never married", community: "Brahmin", sub: "Nagar", city: "Vadodara", state: "Gujarat", native: "Vadodara", tongue: "Gujarati", family: "Nuclear", education: "Post Graduate", profession: "Doctor", income: "₹20–30 lakh", diet: "Vegetarian", father: "Professor", mother: "Doctor", siblings: "1 brother", about: "Paediatrician. Warm, caring, and dedicated to her patients and family.", prefAge: [28, 34], prefHeight: 170, prefMarital: "Never married", relocate: "Yes" },
  { name: "Nidhi Mehta", gender: "FEMALE", phone: "9100000029", age: 29, heightCm: 158, marital: "Never married", community: "Gujarati", sub: "Lohana", city: "Mumbai", state: "Maharashtra", native: "Ahmedabad", tongue: "Gujarati", family: "Nuclear", education: "Professional", profession: "Chartered Accountant", income: "₹20–30 lakh", diet: "Vegetarian", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "Practising CA. Organised, ambitious, and values a strong family bond.", prefAge: [30, 36], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Aarti Desai", gender: "FEMALE", phone: "9100000030", age: 26, heightCm: 161, marital: "Never married", community: "Gujarati", sub: "Shrimali", city: "Ahmedabad", state: "Gujarat", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Service", income: "₹8–12 lakh", diet: "Vegetarian", father: "Retired teacher", mother: "Homemaker", siblings: "2 brothers", about: "Marketing manager. Creative, enthusiastic, and loves travelling.", prefAge: [27, 33], prefHeight: 168, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Shruti Agarwal", gender: "FEMALE", phone: "9100000031", age: 31, heightCm: 156, marital: "Divorced", community: "Marwari", sub: "Agarwal", city: "Jaipur", state: "Rajasthan", native: "Jodhpur", tongue: "Hindi", family: "Nuclear", education: "Post Graduate", profession: "Service", income: "₹15–20 lakh", diet: "Vegetarian", father: "Doctor", mother: "Homemaker", siblings: "1 brother", about: "PR manager. Independent, mature, and seeks a stable and loving partnership.", prefAge: [32, 38], prefHeight: 170, prefMarital: "Any", relocate: "Yes" },
  { name: "Jhanvi Shah", gender: "FEMALE", phone: "9100000032", age: 24, heightCm: 165, marital: "Never married", community: "Gujarati", sub: "Shrimali", city: "Surat", state: "Gujarat", native: "Surat", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹5–8 lakh", diet: "Vegetarian", father: "Diamond trader", mother: "Homemaker", siblings: "1 brother", about: "Manages a boutique. Creative, sociable, and loves cooking traditional food.", prefAge: [26, 31], prefMarital: "Never married", relocate: "No" },
  { name: "Meera Trivedi", gender: "FEMALE", phone: "9100000033", age: 28, heightCm: 162, marital: "Never married", community: "Brahmin", sub: "Audichya", city: "Vadodara", state: "Gujarat", native: "Anand", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹12–15 lakh", diet: "Vegetarian", father: "Retired professor", mother: "Homemaker", siblings: "1 sister", about: "DevOps engineer. Logical, calm, and enjoys hiking.", prefAge: [29, 35], prefHeight: 170, prefMarital: "Never married", relocate: "Yes" },
  { name: "Bhumi Patel", gender: "FEMALE", phone: "9100000034", age: 22, heightCm: 154, marital: "Never married", community: "Patel", sub: "Kadva", city: "Ahmedabad", state: "Gujarat", native: "Gandhinagar", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹3–5 lakh", diet: "Vegetarian", father: "Farmer", mother: "Homemaker", siblings: "2 brothers", about: "Junior nurse. Simple, devoted, and very family-oriented.", prefAge: [24, 29], prefHeight: 168, prefMarital: "Never married", relocate: "No" },
  { name: "Riddhi Jain", gender: "FEMALE", phone: "9100000035", age: 26, heightCm: 159, marital: "Never married", community: "Jain", sub: "Shwetambar", city: "Mumbai", state: "Maharashtra", native: "Ahmedabad", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Doctor", income: "₹20–30 lakh", diet: "Jain", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "Dentist with her own clinic. Compassionate and professionally driven.", prefAge: [27, 33], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Khushi Kapoor", gender: "FEMALE", phone: "9100000036", age: 24, heightCm: 162, marital: "Never married", community: "Gujarati", sub: "Punjabi", city: "Mumbai", state: "Maharashtra", native: "Delhi", tongue: "Hindi", family: "Nuclear", education: "Graduate", profession: "Service", income: "₹5–8 lakh", diet: "Eggetarian", father: "Businessman", mother: "Homemaker", siblings: "1 brother", about: "Flight attendant. Loves travel, cooking, and spending quality time with family.", prefAge: [26, 31], prefMarital: "Never married", relocate: "Yes" },
  { name: "Dharti Parmar", gender: "FEMALE", phone: "9100000037", age: 27, heightCm: 158, marital: "Never married", community: "Patel", sub: "Leuva", city: "Rajkot", state: "Gujarat", native: "Morbi", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Service", income: "₹8–12 lakh", diet: "Vegetarian", father: "Government servant", mother: "Homemaker", siblings: "1 sister", about: "School teacher and aspiring writer. Traditional, warm, and family-oriented.", prefAge: [28, 34], prefHeight: 168, prefMarital: "Never married", relocate: "No" },
  { name: "Komal Choksi", gender: "FEMALE", phone: "9100000038", age: 25, heightCm: 164, marital: "Never married", community: "Jain", sub: "Digambar", city: "Ahmedabad", state: "Gujarat", native: "Ahmedabad", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Business", income: "₹7–10 lakh", diet: "Jain", father: "CA", mother: "Homemaker", siblings: "2 brothers", about: "Co-manages family garment shop. Sincere, disciplined, and close to family.", prefAge: [27, 32], prefMarital: "Never married", relocate: "No" },
  { name: "Sneha Rana", gender: "FEMALE", phone: "9100000039", age: 30, heightCm: 161, marital: "Never married", community: "Gujarati", sub: "Rajput", city: "Vadodara", state: "Gujarat", native: "Patan", tongue: "Gujarati", family: "Joint", education: "Professional", profession: "Doctor", income: "₹25–35 lakh", diet: "Vegetarian", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "General physician. Responsible, empathetic, and seeks a stable partner.", prefAge: [30, 36], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Pooja Vyas", gender: "FEMALE", phone: "9100000040", age: 26, heightCm: 155, marital: "Never married", community: "Brahmin", sub: "Saraswat", city: "Ahmedabad", state: "Gujarat", native: "Junagadh", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹10–15 lakh", diet: "Vegetarian", father: "Retired professor", mother: "Homemaker", siblings: "1 brother", about: "UI/UX designer. Creative, detail-oriented, and loves classical music.", prefAge: [28, 33], prefHeight: 168, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Alisha Malhotra", gender: "FEMALE", phone: "9100000041", age: 28, heightCm: 166, marital: "Never married", community: "Gujarati", sub: "Punjabi", city: "Surat", state: "Gujarat", native: "Chandigarh", tongue: "Punjabi", family: "Nuclear", education: "Post Graduate", profession: "Service", income: "₹10–15 lakh", diet: "Non-vegetarian", father: "Army officer", mother: "Teacher", siblings: "1 brother", about: "Digital marketing manager. Confident, outgoing, and values honesty.", prefAge: [29, 35], prefMarital: "Never married", relocate: "Yes" },
  { name: "Disha Modi", gender: "FEMALE", phone: "9100000042", age: 24, heightCm: 159, marital: "Never married", community: "Patel", sub: "Leuva", city: "Ahmedabad", state: "Gujarat", native: "Ankleshwar", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Business", income: "₹5–7 lakh", diet: "Vegetarian", father: "Chemical engineer", mother: "Homemaker", siblings: "1 sister", about: "Assists in family business. Cheerful, ambitious, and loves art.", prefAge: [26, 31], prefMarital: "Never married", relocate: "No" },
  { name: "Tanisha Bhatt", gender: "FEMALE", phone: "9100000043", age: 23, heightCm: 157, marital: "Never married", community: "Brahmin", sub: "Audichya", city: "Vadodara", state: "Gujarat", native: "Vadodara", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹4–6 lakh", diet: "Vegetarian", father: "Engineer", mother: "Teacher", siblings: "2 sisters", about: "Bank employee. Disciplined, warm, and interested in photography.", prefAge: [25, 30], prefHeight: 168, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Devangee Kothari", gender: "FEMALE", phone: "9100000044", age: 27, heightCm: 163, marital: "Never married", community: "Jain", sub: "Oswal", city: "Rajkot", state: "Gujarat", native: "Rajkot", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Engineer", income: "₹12–15 lakh", diet: "Jain", father: "Jeweller", mother: "Homemaker", siblings: "1 brother", about: "Software engineer. Logical, principled, and passionate about music.", prefAge: [29, 34], prefHeight: 170, prefMarital: "Never married", relocate: "Yes" },
  { name: "Heli Raval", gender: "FEMALE", phone: "9100000045", age: 25, heightCm: 160, marital: "Never married", community: "Gujarati", sub: "Lohana", city: "Mumbai", state: "Maharashtra", native: "Surat", tongue: "Gujarati", family: "Nuclear", education: "Post Graduate", profession: "Service", income: "₹8–12 lakh", diet: "Vegetarian", father: "Banker", mother: "Homemaker", siblings: "1 sister", about: "Graphic designer at a media firm. Creative, calm, and loves cooking.", prefAge: [27, 32], prefMarital: "Never married", relocate: "No" },
  { name: "Foram Prajapati", gender: "FEMALE", phone: "9100000046", age: 22, heightCm: 154, marital: "Never married", community: "Gujarati", sub: "Prajapati", city: "Ahmedabad", state: "Gujarat", native: "Nadiad", tongue: "Gujarati", family: "Joint", education: "Graduate", profession: "Service", income: "₹3–5 lakh", diet: "Vegetarian", father: "Farmer", mother: "Homemaker", siblings: "2 brothers", about: "Government teacher. Honest, devoted, and enjoys classical dance.", prefAge: [24, 29], prefHeight: 168, prefMarital: "Never married", relocate: "No" },
  { name: "Charmi Shah", gender: "FEMALE", phone: "9100000047", age: 29, heightCm: 161, marital: "Never married", community: "Gujarati", sub: "Shrimali", city: "Surat", state: "Gujarat", native: "Surat", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Doctor", income: "₹20–30 lakh", diet: "Vegetarian", father: "Retired government officer", mother: "Homemaker", siblings: "1 brother", about: "Gynaecologist. Caring, professional, and family-focused.", prefAge: [30, 36], prefHeight: 170, prefMarital: "Never married", relocate: "Maybe" },
  { name: "Manali Trivedi", gender: "FEMALE", phone: "9100000048", age: 26, heightCm: 162, marital: "Never married", community: "Brahmin", sub: "Nagar", city: "Ahmedabad", state: "Gujarat", native: "Ahmedabad", tongue: "Gujarati", family: "Joint", education: "Post Graduate", profession: "Service", income: "₹10–15 lakh", diet: "Vegetarian", father: "Architect", mother: "Teacher", siblings: "1 brother", about: "UX researcher. Curious, empathetic, and passionate about sustainability.", prefAge: [28, 33], prefHeight: 170, prefMarital: "Never married", relocate: "Yes" },
  { name: "Nisha Desai", gender: "FEMALE", phone: "9100000049", age: 31, heightCm: 165, marital: "Divorced", community: "Gujarati", sub: "Leuva", city: "Surat", state: "Gujarat", native: "Palanpur", tongue: "Gujarati", family: "Nuclear", education: "Professional", profession: "Chartered Accountant", income: "₹20–25 lakh", diet: "Vegetarian", father: "Retired banker", mother: "Homemaker", siblings: "None", about: "CA in private practice. Seeks a caring, understanding partner for a fresh start.", prefAge: [31, 38], prefMarital: "Any", relocate: "No" },
  { name: "Vini Mehta", gender: "FEMALE", phone: "9100000050", age: 23, heightCm: 158, marital: "Never married", community: "Gujarati", sub: "Lohana", city: "Mumbai", state: "Maharashtra", native: "Bhavnagar", tongue: "Gujarati", family: "Nuclear", education: "Graduate", profession: "Business", income: "₹5–7 lakh", diet: "Vegetarian", father: "Businessman", mother: "Homemaker", siblings: "1 sister", about: "Manages a home decor store. Bright, outgoing, and loves interior design.", prefAge: [25, 30], prefHeight: 168, prefMarital: "Never married", relocate: "Maybe" },
];

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  let created = 0;
  let skipped = 0;

  for (const t of MEMBERS) {
    if (await prisma.member.findUnique({ where: { phone: t.phone } })) {
      console.log("skip (exists):", t.name);
      skipped++;
      continue;
    }

    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - t.age);
    dob.setMonth(Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27));

    const tagKeys: [string, string][] = [
      ["Community", t.community],
      ["City", t.city],
      ["Education", t.education],
      ["Profession", t.profession],
    ];
    const tags = (
      await Promise.all(
        tagKeys.map(([c, v]) =>
          prisma.tagValue.findFirst({ where: { value: v, category: { name: c } } })
        )
      )
    ).filter((x) => x);

    const emailSlug = t.name.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "");
    const phoneNum = t.phone.slice(-4);

    const m = await prisma.member.create({
      data: {
        profileCode: await nextProfileCode(),
        status: "APPROVED",
        approvedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000),
        source: "ADMIN",
        consentGiven: true,
        fullName: t.name,
        phone: t.phone,
        email: `${emailSlug}.${phoneNum}@example.com`,
        gender: t.gender,
        dob,
        heightCm: t.heightCm,
        maritalStatus: t.marital,
        community: t.community,
        subCommunity: t.sub,
        city: t.city,
        state: t.state,
        nativePlace: t.native,
        motherTongue: t.tongue,
        familyType: t.family,
        education: t.education,
        profession: t.profession,
        income: t.income,
        diet: t.diet,
        fatherOccupation: t.father,
        motherOccupation: t.mother,
        siblings: t.siblings,
        about: t.about,
        familyBackground: "A well-settled, respectable family with traditional values.",
        createdBy: "Parent",
        prefAgeMin: t.prefAge[0],
        prefAgeMax: t.prefAge[1],
        prefHeightMinCm: t.prefHeight,
        prefMaritalStatus: t.prefMarital ?? "Never married",
        prefRelocate: t.relocate,
        passwordHash: hash,
        mustChangePassword: false,
        tags: { create: tags.map((x) => ({ tagValueId: x!.id })) },
      },
    });

    console.log("created:", m.profileCode, t.name, t.gender, t.age, t.city);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
