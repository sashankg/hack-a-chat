// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { TimexProperty } = require('@microsoft/recognizers-text-data-types-timex-expression');
const { ComponentDialog, DialogSet, DialogTurnStatus, TextPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { PersonDatabase } = require('../resources/personDatabase');
const { BookingDialog } = require('./bookingDialog');
const { ArticleDialog } = require('./findArticleDialog');
const { PersonDialog } = require('./personDialog');

const { LuisHelper } = require('./luisHelper');

const MAIN_WATERFALL_DIALOG = 'mainWaterfallDialog';
const ARTICLE_DIALOG = 'articleDialog';
const PERSON_DIALOG = 'personDialog'

class MainDialog extends ComponentDialog {
    constructor(logger) {
        super('MainDialog');

        if (!logger) {
            logger = console;
            logger.log('[MainDialog]: logger not passed in, defaulting to console');
        }

        this.logger = logger;

        // Define the main dialog and its related components.
        // This is a sample "book a flight" dialog.
        this.addDialog(new TextPrompt('TextPrompt'))
            .addDialog(new PersonDialog(PERSON_DIALOG))
            .addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
                this.introStep.bind(this),
                this.actStep.bind(this),
                this.finalStep.bind(this)
            ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
    }

    static findPeople(constraints) {
        var bestResult;

        for (var key in PersonDatabase) {
            console.log("checking " + key);
            console.log(!constraints.expertise || PersonDatabase[key].expertise.includes(constraints.expertise[0]));
            console.log(!constraints.language || PersonDatabase[key].languages.includes(constraints.language[0]));
            console.log(!constraints.team || PersonDatabase[key].team === constraints.team);
            console.log(PersonDatabase[key].expertise);
            if ((!constraints.expertise || PersonDatabase[key].expertise.includes(constraints.expertise[0])) &&
                (!constraints.language || PersonDatabase[key].languages.includes(constraints.language[0])) &&
                (!constraints.team || PersonDatabase[key].team === constraints.team[0])) {
                console.log("matched " + PersonDatabase[key].name);
                PersonDatabase[key].dist = Math.abs(PersonDatabase[key].location - constraints.location);
                if (!bestResult || PersonDatabase[key].dist < bestResult.dist) {
                    bestResult = PersonDatabase[key];
                }
            }
        }

        return bestResult;
    }

    /**
     * The run method handles the incoming activity (in the form of a DialogContext) and passes it through the dialog system.
     * If no dialog is active, it will start the default dialog.
     * @param {*} dialogContext
     */
    async run(context, accessor) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(context);
        const results = await dialogContext.continueDialog();
        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    /**
     * First step in the waterfall dialog. Prompts the user for a command.
     * Currently, this expects a booking request, like "book me a flight from Paris to Berlin on march 22"
     * Note that the sample LUIS model will only recognize Paris, Berlin, New York and London as airport cities.
     */
    async introStep(stepContext) {
        if (!process.env.LuisAppId || !process.env.LuisAPIKey || !process.env.LuisAPIHostName) {
            await stepContext.context.sendActivity('NOTE: LUIS is not configured. To enable all capabilities, add `LuisAppId`, `LuisAPIKey` and `LuisAPIHostName` to the .env file.');
            return await stepContext.next();
        }

        return await stepContext.prompt('TextPrompt', { prompt: 'Who do you want to find?' });
    }

    /**
     * Second step in the waterall.  This will use LUIS to attempt to extract the origin, destination and travel dates.
     * Then, it hands off to the bookingDialog child dialog to collect any remaining details.
     */
    async actStep(stepContext) {
        let queryResult = {}

        if (process.env.LuisAppId && process.env.LuisAPIKey && process.env.LuisAPIHostName) {
            // Call LUIS and gather any potential booking details.
            // This will attempt to extract the origin, destination and travel date from the user's message
            // and will then pass those values into the booking dialog
            queryResult = await LuisHelper.executeLuisQuery(this.logger, stepContext.context);

            this.logger.log('LUIS extracted these article details:', queryResult);
        }

        if (!queryResult.location) {
            queryResult.location = 27
        }

        // In this sample we only have a single intent we are concerned with. However, typically a scenario
        // will have multiple different intents each corresponding to starting a different child dialog.

        // Run the BookingDialog giving it whatever details we have from the LUIS call, it will fill out the remainder.
        if (queryResult.intent === 'findPerson') {
            return await stepContext.beginDialog(PERSON_DIALOG, queryResult)
        }
        if (queryResult.intent === 'List_articles_by_place') {
            return await stepContext.beginDialog(ARTICLE_DIALOG, queryResult)
        }
        //return await stepContext.beginDialog('bookingDialog', queryResult);
    }

    /**
     * This is the final step in the main waterfall dialog.
     * It wraps up the sample "book a flight" interaction with a simple confirmation.
     */
    async finalStep(stepContext) {
        // If the child dialog ("bookingDialog") was cancelled or the user failed to confirm, the Result here will be null.
        if (stepContext.result) {
            const result = stepContext.result;
            // Now we have all the booking details.

            console.log(result);

            // This is where calls to the booking AOU service or database would go.
            let msg = 'I wasn\'t able to find anyone :( Try searching with different specs?'
            var foundPerson = MainDialog.findPeople(result);

            console.log(foundPerson);

            if (foundPerson) {
                msg = `You should talk to ${foundPerson.name} in Building ${foundPerson.location}!`; 
            }

            // If the call to the booking service was successful tell the user.
            const timeProperty = new TimexProperty(result.travelDate);
            const travelDateMsg = timeProperty.toNaturalLanguage(new Date(Date.now()));
            await stepContext.context.sendActivity(msg, 'yeet');
        } else {
            await stepContext.context.sendActivity('Thank you.');
        }
        return await stepContext.beginDialog(MAIN_WATERFALL_DIALOG);
        //return await stepContext.endDialog();
    }
}

module.exports.MainDialog = MainDialog;
