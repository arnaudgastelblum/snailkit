// Words that tell a sentence is probably a task: an action verb at the start (or, in Dutch, an
// infinitive at the end: "verzekering bellen"). Generic verbs only, in the four languages of the
// interface: a session can be written in any of them, whatever the interface language.

/** Phrases that announce a task without being part of it ("don't forget to call" is "call"). */
export const FILLERS: string[] = [
	// English
	"don't forget to", "do not forget to", "dont forget to", "remember to", "i need to", "we need to", "need to",
	"i have to", "we have to", "have to", "i must", "we must", "must", "i should", "we should", "todo:", "to do:",
	// French
	"ne pas oublier de", "ne pas oublier d'", "n'oublie pas de", "n'oubliez pas de", "penser à", "pensez à",
	"il faut que je", "il faut", "il faudrait", "faut", "je dois", "on doit", "nous devons", "à faire :", "à faire:",
	// Dutch
	"niet vergeten om", "niet vergeten te", "niet vergeten:", "niet vergeten", "vergeet niet te", "vergeet niet",
	"denk eraan om", "denk eraan", "ik moet nog", "ik moet", "we moeten nog", "we moeten", "nog even", "moet nog", "moet",
	// Spanish
	"no olvidar", "no olvides", "no te olvides de", "acordarse de", "acuérdate de", "recordar", "hay que",
	"tengo que", "tenemos que", "debo", "debemos", "pendiente:",
];

const EN = `add answer arrange ask book buy call cancel change check choose clean clear close collect compare
confirm contact cook copy create decide delete deliver draft drop email empty find finish fix follow get give
hang install invite look make move order organize organise pack pay phone pick plan post prepare print put read
reply renew repair replace reserve return review schedule sell send set share sign sort start submit test text
tidy try update upload visit wash watch write
bring configure deploy discuss download explore fill finalize finalise gather hire meet merge migrate order
register remind remove rename request transfer translate`;

const FR = `acheter ajouter aller annuler appeler apporter arroser changer chercher choisir classer commander
comparer compléter confirmer contacter corriger créer déposer demander déplacer écrire effacer envoyer essayer
faire finir fixer imprimer inscrire installer inviter jeter laver lire mettre nettoyer noter offrir organiser
partager payer planifier porter poser poster préparer prendre prévoir proposer ranger rappeler récupérer
regarder relancer relire remplacer remplir renouveler réparer répondre réserver résilier retirer réviser
signer sortir supprimer terminer tester trier valider vendre vérifier vider visiter`;

const NL = `aanvragen afmaken afspreken bekijken bellen bestellen betalen bijwerken boeken brengen controleren
doen halen herhalen inplannen installeren invullen kiezen kopen lezen maken mailen nakijken opbellen opruimen
opschrijven opzeggen organiseren plannen poetsen regelen repareren reserveren schoonmaken schrijven sturen
testen uitzoeken vegen verkopen vernieuwen versturen vervangen voorbereiden wassen zoeken geven nemen vragen
afhalen afronden bezorgen inleveren ophalen opzoeken terugbrengen verlengen verzenden`;

/** Dutch imperatives at the start ("Bel de verzekering"). */
const NL_IMPERATIVE = `bel bestel betaal boek breng check controleer haal kies koop lees maak mail plan regel ruim
schrijf stuur test vraag zoek`;

const ES = `abrir actualizar añadir anotar apuntar arreglar borrar buscar cambiar cancelar cerrar comparar
completar comprar comprobar confirmar contactar contestar crear devolver elegir enviar escribir hacer imprimir
instalar invitar ir lavar leer limpiar llamar llevar mandar mirar ordenar organizar pagar pedir planificar poner
preguntar preparar probar programar quitar recoger reparar reservar responder revisar sacar terminar vaciar
vender visitar dar`;

const words = (list: string) => list.split(/\s+/).filter(Boolean);

/** Verbs recognized at the start of a sentence, lowercased. */
export const START_VERBS: ReadonlySet<string> = new Set([...words(EN), ...words(FR), ...words(NL), ...words(NL_IMPERATIVE), ...words(ES)]);

/** Dutch infinitives recognized at the end of a sentence ("de verzekering bellen"). */
export const END_VERBS: ReadonlySet<string> = new Set(words(NL));

/** Short words that never say what a task is about (ignored when learning tags). */
export const STOP_WORDS: ReadonlySet<string> = new Set(words(`
the and for with from that this then into about after before over your our their some more
les des une pour avec dans sur par pas plus que qui est son ses mes nos vos aux cette ces
het een van voor met dat die zijn ook nog maar naar bij over als dan wat
los las una unos para con por del que más sus mis esta este
`));

// ----- the shape of an infinitive (see `actionVerb` in logic.ts) -----
// Every word below is lowercased and without accents ("deburred"), as the analysis compares them.

/**
 * Words shaped like an infinitive (French -er -ir -re, Spanish -ar -er -ir, Dutch -eren) that are
 * not one. Only the frequent ones that may open a note's sentence: a longer list would only cost.
 */
export const NOT_VERBS: ReadonlySet<string> = new Set(words(`
hier premier dernier entier cher fier amer hiver super enfer leger danger berger verger foyer loyer
dossier fichier papier calendrier courrier quartier metier cahier clavier panier atelier chantier escalier
janvier fevrier particulier regulier pompier plombier immobilier sentier boucher boulanger rocher plancher
cancer laser poster manager leader newsletter master sticker flyer planner
plaisir desir loisir avenir saphir elixir porvenir
lettre ordre desordre cadre poudre foudre cidre cylindre moindre padre madre maitre traitre
pire empire navire satire vampire cire delire entire livre cuivre givre ivre
etre avoir pouvoir devoir savoir vouloir falloir valoir
ser estar haber tener poder deber saber querer soler
mar lugar hogar altar pilar collar dolar radar azucar familiar particular similar popular regular militar
solar escolar lunar celular nuclear singular peculiar titular auxiliar espectacular muscular vulgar ejemplar
polar malestar bienestar cauchemar hangar bazar calendar dollar sugar seminar year near clear dear star
ayer mujer alfiler taller caracter crater lider sueter cadaver chofer alquiler placer amanecer atardecer
anochecer suerte muerte fuerte alarme charme gendarme liberte fierte charles inverse universe diverse
reverse converse sparse coarse
never ever other after under over later either neither whether rather together better
weer meer verder beter eerder onder zomer winter water nummer kamer vader moeder ander
bier dier kwartier manier vier plezier
kinderen kleren eieren liederen runderen kalveren lammeren bladeren volkeren raderen goederen beenderen
quieren prefieren requieren hieren gisteren
primer tercer
september october november december oktober
olivier didier xavier roger gauthier
`));

/** French verbs in -oir: the other words in -oir are nouns (soir, miroir, couloir, tiroir...). */
export const OIR_VERBS: ReadonlySet<string> = new Set(words("voir revoir prevoir entrevoir pourvoir recevoir percevoir apercevoir decevoir concevoir asseoir"));

/** Pronouns that may come before a French infinitive ("lui envoyer le devis", "en parler"). */
export const CLITICS: ReadonlySet<string> = new Set(words("lui leur en y me te se"));

/** Articles that are also pronouns: "le rappeler" is a task, "le dîner" is not, so only known verbs follow them. */
export const ARTICLE_CLITICS: ReadonlySet<string> = new Set(words("le la les"));

/** Dutch separable prefixes ("terugbellen", "doorsturen"). */
export const NL_PREFIXES: readonly string[] = words("terug door weg mee aan af bij in na om op over toe uit voor");

/**
 * Finite verbs that, second in a sentence, show the first word is its subject ("Test is
 * failing", "Manger est important"): not a task.
 */
export const FINITE: ReadonlySet<string> = new Set(words(`
est sont etait etaient sera seront ont avait aura vont peut doit semble
esta estan era fue sera ha han habia tiene puede debe parece
is are was were has had could would seems isn't wasn't
heeft wordt kan zal lijkt waren
`));

/**
 * Words that only one language uses (folded, accents kept): they tell which language a sentence is
 * written in, so that an English or Dutch sentence is never read with French or Spanish endings.
 * Words shared by two languages ("de", "en", "la", "a", "me", "te") are left out.
 */
export const MARKERS: Record<"fr" | "es" | "en" | "nl", ReadonlySet<string>> = {
	fr: new Set(words(`le les des du une au aux et pour avec dans sur chez mon ma mes ton ta tes son sa ses ce cette
ces leur leurs notre votre nos vos à qui pas ne je il elle nous vous ils elles est sont ou où puis demain
avant après apres très plus sans aussi encore quand comme par`)),
	es: new Set(words(`el los las del al y para con por mi mis su sus una lo es este esta estos estas ese esa esos esas
mañana manana hoy antes después despues muy más mas sin pero también tambien nuestro nuestra hasta desde
cuando unos unas está`)),
	en: new Set(words(`the an to of for with and my your our their his her its it this that these those on at from by
is are be was will can all some about into up out just not i we you they he she before after`)),
	nl: new Set(words(`het een van voor met op naar bij om aan niet ook nog maar die dit deze wat ik jij mijn jouw onze
ons hij zij er dan als heb kan wil wordt morgen vandaag even wel`)),
};
