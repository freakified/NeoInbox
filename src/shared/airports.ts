/**
 * IATA airport → city table. Doubles as the whitelist that keeps the flight
 * extractors from treating every capitalized 3-letter word as an airport,
 * and as the lookup behind auto-naming ("Trip to Tokyo"). Not exhaustive —
 * major US/international airports plus everything Japan-adjacent (ZipAir/JAL
 * routes); unknown codes still cluster fine, they just name the trip by code.
 */
export const AIRPORT_CITIES: Record<string, string> = {
  // US — west
  SFO: "San Francisco", OAK: "Oakland", SJC: "San Jose", SMF: "Sacramento",
  LAX: "Los Angeles", BUR: "Burbank", LGB: "Long Beach", SNA: "Orange County",
  ONT: "Ontario", SAN: "San Diego", PSP: "Palm Springs", FAT: "Fresno",
  SEA: "Seattle", PDX: "Portland", GEG: "Spokane", BOI: "Boise",
  LAS: "Las Vegas", RNO: "Reno", PHX: "Phoenix", TUS: "Tucson",
  SLC: "Salt Lake City", DEN: "Denver", COS: "Colorado Springs",
  ABQ: "Albuquerque", ANC: "Anchorage", FAI: "Fairbanks",
  HNL: "Honolulu", OGG: "Maui", KOA: "Kona", LIH: "Kauai", ITO: "Hilo",
  // US — central
  DFW: "Dallas", DAL: "Dallas", IAH: "Houston", HOU: "Houston",
  AUS: "Austin", SAT: "San Antonio", ELP: "El Paso",
  ORD: "Chicago", MDW: "Chicago", MSP: "Minneapolis", STL: "St. Louis",
  MCI: "Kansas City", OMA: "Omaha", OKC: "Oklahoma City", TUL: "Tulsa",
  MSY: "New Orleans", MEM: "Memphis", BNA: "Nashville", SDF: "Louisville",
  IND: "Indianapolis", CVG: "Cincinnati", CMH: "Columbus", DTW: "Detroit",
  MKE: "Milwaukee", CLE: "Cleveland",
  // US — east
  JFK: "New York", LGA: "New York", EWR: "New York",
  BOS: "Boston", PVD: "Providence", BDL: "Hartford",
  PHL: "Philadelphia", PIT: "Pittsburgh",
  IAD: "Washington, D.C.", DCA: "Washington, D.C.", BWI: "Baltimore",
  RDU: "Raleigh", CLT: "Charlotte", RIC: "Richmond", ORF: "Norfolk",
  ATL: "Atlanta", SAV: "Savannah", JAX: "Jacksonville",
  MCO: "Orlando", TPA: "Tampa", MIA: "Miami", FLL: "Fort Lauderdale",
  PBI: "West Palm Beach", RSW: "Fort Myers", BUF: "Buffalo", ROC: "Rochester",
  SYR: "Syracuse", ALB: "Albany", BTV: "Burlington", PWM: "Portland, ME",
  // Canada / Mexico / Caribbean / Central America
  YVR: "Vancouver", YYC: "Calgary", YEG: "Edmonton", YYZ: "Toronto",
  YUL: "Montreal", YOW: "Ottawa", YHZ: "Halifax",
  MEX: "Mexico City", CUN: "Cancún", GDL: "Guadalajara", SJD: "Los Cabos",
  PVR: "Puerto Vallarta", MTY: "Monterrey", OAX: "Oaxaca",
  SJU: "San Juan", NAS: "Nassau", MBJ: "Montego Bay", AUA: "Aruba",
  PUJ: "Punta Cana", SJO: "San José, CR", LIR: "Liberia", PTY: "Panama City",
  BZE: "Belize City", GUA: "Guatemala City",
  // South America
  BOG: "Bogotá", MDE: "Medellín", LIM: "Lima", UIO: "Quito",
  GRU: "São Paulo", GIG: "Rio de Janeiro", EZE: "Buenos Aires",
  SCL: "Santiago", MVD: "Montevideo",
  // Europe
  LHR: "London", LGW: "London", STN: "London", LCY: "London",
  MAN: "Manchester", EDI: "Edinburgh", GLA: "Glasgow", DUB: "Dublin",
  CDG: "Paris", ORY: "Paris", NCE: "Nice", LYS: "Lyon",
  AMS: "Amsterdam", BRU: "Brussels", LUX: "Luxembourg",
  FRA: "Frankfurt", MUC: "Munich", BER: "Berlin", HAM: "Hamburg",
  DUS: "Düsseldorf", ZRH: "Zurich", GVA: "Geneva", VIE: "Vienna",
  PRG: "Prague", BUD: "Budapest", WAW: "Warsaw", KRK: "Kraków",
  CPH: "Copenhagen", OSL: "Oslo", ARN: "Stockholm", HEL: "Helsinki",
  KEF: "Reykjavík", MAD: "Madrid", BCN: "Barcelona", AGP: "Málaga",
  LIS: "Lisbon", OPO: "Porto", FCO: "Rome", MXP: "Milan", LIN: "Milan",
  VCE: "Venice", FLR: "Florence", NAP: "Naples", ATH: "Athens",
  IST: "Istanbul", SAW: "Istanbul",
  // Middle East / Africa
  DXB: "Dubai", AUH: "Abu Dhabi", DOH: "Doha", TLV: "Tel Aviv",
  CAI: "Cairo", CMN: "Casablanca", JNB: "Johannesburg", CPT: "Cape Town",
  NBO: "Nairobi", ADD: "Addis Ababa",
  // Japan
  NRT: "Tokyo", HND: "Tokyo", KIX: "Osaka", ITM: "Osaka", UKB: "Kobe",
  NGO: "Nagoya", CTS: "Sapporo", FUK: "Fukuoka", OKA: "Okinawa",
  HIJ: "Hiroshima", SDJ: "Sendai", KMJ: "Kumamoto", KOJ: "Kagoshima",
  TAK: "Takamatsu", MYJ: "Matsuyama", KCZ: "Kōchi", ISG: "Ishigaki",
  // Asia — rest
  ICN: "Seoul", GMP: "Seoul", PUS: "Busan",
  PEK: "Beijing", PKX: "Beijing", PVG: "Shanghai", SHA: "Shanghai",
  CAN: "Guangzhou", SZX: "Shenzhen", HKG: "Hong Kong", MFM: "Macau",
  TPE: "Taipei", TSA: "Taipei", KHH: "Kaohsiung",
  MNL: "Manila", CEB: "Cebu", SGN: "Ho Chi Minh City", HAN: "Hanoi",
  DAD: "Da Nang", BKK: "Bangkok", DMK: "Bangkok", CNX: "Chiang Mai",
  HKT: "Phuket", KUL: "Kuala Lumpur", SIN: "Singapore", CGK: "Jakarta",
  DPS: "Bali", PNH: "Phnom Penh", REP: "Siem Reap", RGN: "Yangon",
  KTM: "Kathmandu", DEL: "Delhi", BOM: "Mumbai", BLR: "Bengaluru",
  MAA: "Chennai", HYD: "Hyderabad", CMB: "Colombo", MLE: "Malé",
  // Oceania
  SYD: "Sydney", MEL: "Melbourne", BNE: "Brisbane", PER: "Perth",
  AKL: "Auckland", WLG: "Wellington", CHC: "Christchurch",
  NAN: "Nadi", PPT: "Papeete", GUM: "Guam",
};

export const isKnownAirport = (code: string): boolean =>
  Object.prototype.hasOwnProperty.call(AIRPORT_CITIES, code);

export const cityOfAirport = (code: string): string =>
  AIRPORT_CITIES[code] ?? code;

/**
 * Two-letter IATA airline codes the generic flight parser accepts as flight-
 * number prefixes; without a whitelist, "IS 2024" reads as a flight.
 */
export const AIRLINE_CODES = new Set([
  "UA", "AA", "DL", "WN", "AS", "B6", "NK", "F9", "HA", "G4", "SY",
  "AC", "WS", "AM", "Y4",
  "BA", "VS", "EI", "AF", "KL", "LH", "LX", "OS", "SN", "AZ", "IB",
  "TP", "SK", "AY", "FI", "LO", "TK", "EK", "EY", "QR", "SV", "LY",
  "NH", "JL", "ZG", "MM", "BC", "OZ", "KE", "LJ", "TW",
  "CA", "MU", "CZ", "CX", "BR", "CI", "JX", "PR", "VN", "TG", "SQ",
  "TR", "MH", "AK", "D7", "GA", "QF", "JQ", "NZ", "FJ",
]);
