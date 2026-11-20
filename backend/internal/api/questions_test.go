package api

import (
	"reflect"
	"testing"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestQuestionContracts(t *testing.T) {
	for _, tc := range []struct {
		name    string
		input   pollInput
		want    []string
		invalid bool
	}{
		{"legacy", pollInput{Choices: []string{"A", "B"}}, []string{"A", "B"}, false},
		{"ranking", pollInput{Question: &models.Question{Version: 1, Type: models.RankedChoice}, Choices: []string{"A", "B"}}, []string{"A", "B"}, false},
		{"rating", pollInput{Question: &models.Question{Version: 1, Type: models.Rating, Min: 1, Max: 4}}, []string{"1", "2", "3", "4"}, false},
		{"cloud", pollInput{Question: &models.Question{Version: 1, Type: models.WordCloud}}, []string{}, false},
		{"bad range", pollInput{Question: &models.Question{Version: 1, Type: models.MultipleChoice, Min: 2, Max: 3}, Choices: []string{"A", "B"}}, nil, true},
		{"unsupported", pollInput{Question: &models.Question{Version: 2, Type: models.SingleChoice}}, nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := configureQuestion(&tc.input)
			if (err != nil) != tc.invalid || !tc.invalid && !reflect.DeepEqual(tc.input.Choices, tc.want) {
				t.Fatalf("choices=%v error=%v", tc.input.Choices, err)
			}
		})
	}
}
func TestBallotTypeAndProjection(t *testing.T) {
	word := "  ＥNERGY  FLOW "
	rating, choice := 10, 0
	for _, tc := range []struct {
		name, kind string
		ballot     ballotInput
		want       bson.M
	}{
		{"single", models.SingleChoice, ballotInput{Choice: &choice}, bson.M{"version": 1, "ballots": 1, "counts.0": 1}},
		{"multiple", models.MultipleChoice, ballotInput{Choices: []int{1, 2}}, bson.M{"version": 1, "ballots": 1, "counts.1": 1, "counts.2": 1}},
		{"ranked", models.RankedChoice, ballotInput{Ranking: []int{2, 0, 1}}, bson.M{"version": 1, "ballots": 1, "counts.2": 1, "rankPoints.2": 2, "rankPoints.0": 1}},
		{"cloud", models.WordCloud, ballotInput{Text: &word}, bson.M{"version": 1, "ballots": 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := models.Poll{Choices: []string{"A", "B", "C"}, Question: &models.Question{Version: 1, Type: tc.kind, Min: 1, Max: 2}}
			if !tc.ballot.validate() {
				t.Fatal("invalid ballot")
			}
			ballot, ok := tc.ballot.forPoll(p)
			if !ok || !reflect.DeepEqual(countBallot(p, ballot), tc.want) {
				t.Fatalf("ballot=%+v changes=%v", ballot, countBallot(p, ballot))
			}
			if tc.kind == models.WordCloud && (ballot.Term != "energy flow" || ballot.Moderation != "pending") {
				t.Fatalf("%+v", ballot)
			}
		})
	}
	p := models.Poll{Choices: make([]string, 10), Question: &models.Question{Version: 1, Type: models.Rating, Min: 1, Max: 10}}
	b := ballotInput{Rating: &rating}
	if got, ok := b.forPoll(p); !b.validate() || !ok || got.Choice != 9 {
		t.Fatalf("rating ballot=%+v", got)
	}
	badText := "<b>hello</b>"
	for _, bad := range []ballotInput{{Choice: &choice, Rating: &rating}, {Choices: []int{1, 1}}, {Ranking: []int{1, 1}}, {Text: &badText}} {
		if bad.validate() {
			t.Errorf("accepted invalid %+v", bad)
		}
	}
}
