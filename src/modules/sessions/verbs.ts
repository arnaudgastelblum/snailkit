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
tidy try update upload visit wash watch write`;

const FR = `acheter ajouter aller annuler appeler apporter arroser changer chercher choisir classer commander
comparer compléter confirmer contacter corriger créer déposer demander déplacer écrire effacer envoyer essayer
faire finir fixer imprimer inscrire installer inviter jeter laver lire mettre nettoyer noter offrir organiser
partager payer planifier porter poser poster préparer prendre prévoir proposer ranger rappeler récupérer
regarder relancer relire remplacer remplir renouveler réparer répondre réserver résilier retirer réviser
signer sortir supprimer terminer tester trier valider vendre vérifier vider visiter`;

const NL = `aanvragen afmaken afspreken bekijken bellen bestellen betalen bijwerken boeken brengen controleren
doen halen herhalen inplannen installeren invullen kiezen kopen lezen maken mailen nakijken opbellen opruimen
opschrijven opzeggen organiseren plannen poetsen regelen repareren reserveren schoonmaken schrijven sturen
testen uitzoeken vegen verkopen vernieuwen versturen vervangen voorbereiden wassen zoeken`;

/** Dutch imperatives at the start ("Bel de verzekering"). */
const NL_IMPERATIVE = `bel bestel betaal boek breng check controleer haal kies koop lees maak mail plan regel ruim
schrijf stuur test vraag zoek`;

const ES = `abrir actualizar añadir anotar apuntar arreglar borrar buscar cambiar cancelar cerrar comparar
completar comprar comprobar confirmar contactar contestar crear devolver elegir enviar escribir hacer imprimir
instalar invitar ir lavar leer limpiar llamar llevar mandar mirar ordenar organizar pagar pedir planificar poner
preguntar preparar probar programar quitar recoger reparar reservar responder revisar sacar terminar vaciar
vender visitar`;

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
