package api

import (
	"errors"
	"strconv"
	"strings"
	"unicode"

	"github.com/Sanjayram3269/Pulsex/backend/internal/models"
	"golang.org/x/text/unicode/norm"
)

func configureQuestion(in *pollInput) error {
	if in.Question != nil {
		q := in.Question
		if q.Version != 1 {
			return errors.New("Unsupported question contract version.")
		}
		switch q.Type {
		case models.Rating:
			if len(in.Choices) != 0 || q.Min != 1 || q.Max < 3 || q.Max > 10 {
				return errors.New("A rating scale must run from 1 to a maximum of 3–10.")
			}
			for i := q.Min; i <= q.Max; i++ {
				in.Choices = append(in.Choices, strconv.Itoa(i))
			}
			return nil
		case models.WordCloud:
			if len(in.Choices) != 0 || q.Min != 0 || q.Max != 0 {
				return errors.New("A word cloud does not take predefined choices or bounds.")
			}
			in.Choices = []string{}
			return nil
		case models.MultipleChoice:
			if q.Min < 1 || q.Max < q.Min || q.Max > len(in.Choices) {
				return errors.New("Selection limits must fit the available choices.")
			}
		case models.SingleChoice, models.RankedChoice:
			if q.Min != 0 || q.Max != 0 {
				return errors.New("This question type does not use selection bounds.")
			}
		default:
			return errors.New("Unsupported question type.")
		}
	}
	if len(in.Choices) < 2 || len(in.Choices) > 8 {
		return errors.New("Add 2–8 choices.")
	}
	for i, value := range in.Choices {
		value = strings.TrimSpace(value)
		if !singleLine(value, 1, 80) {
			return errors.New("Each choice must have 1–80 characters.")
		}
		for _, previous := range in.Choices[:i] {
			if strings.EqualFold(value, previous) {
				return errors.New("Each choice must be different.")
			}
		}
		in.Choices[i] = value
	}
	return nil
}

type ballotInput struct {
	Choice  *int    `json:"choice"`
	Choices []int   `json:"choices"`
	Rating  *int    `json:"rating"`
	Ranking []int   `json:"ranking"`
	Text    *string `json:"text"`
}

func (b *ballotInput) kind() string {
	var kinds []string
	if b.Choice != nil {
		kinds = append(kinds, models.SingleChoice)
	}
	if b.Choices != nil {
		kinds = append(kinds, models.MultipleChoice)
	}
	if b.Rating != nil {
		kinds = append(kinds, models.Rating)
	}
	if b.Ranking != nil {
		kinds = append(kinds, models.RankedChoice)
	}
	if b.Text != nil {
		kinds = append(kinds, models.WordCloud)
	}
	if len(kinds) != 1 {
		return ""
	}
	return kinds[0]
}
func (b *ballotInput) validate() bool {
	switch b.kind() {
	case models.SingleChoice:
		return *b.Choice >= 0 && *b.Choice < 8
	case models.Rating:
		return *b.Rating >= 1 && *b.Rating <= 10
	case models.MultipleChoice:
		return distinctChoices(b.Choices, 8)
	case models.RankedChoice:
		return distinctChoices(b.Ranking, 8)
	case models.WordCloud:
		if !validText(*b.Text, 1, 100) {
			return false
		}
		value := strings.ToLower(strings.Join(strings.Fields(norm.NFKC.String(*b.Text)), " "))
		if !singleLine(value, 1, 40) {
			return false
		}
		hasText := false
		for _, r := range value {
			switch {
			case unicode.IsLetter(r), unicode.IsNumber(r):
				hasText = true
			case unicode.IsMark(r), r == ' ', r == '-', r == '\'':
			default:
				return false
			}
		}
		b.Text = &value
		return hasText
	}
	return false
}
func distinctChoices(choices []int, size int) bool {
	if len(choices) == 0 || len(choices) > size {
		return false
	}
	var seen uint16
	for _, i := range choices {
		if i < 0 || i >= size || seen&(1<<i) != 0 {
			return false
		}
		seen |= 1 << i
	}
	return true
}

func (b ballotInput) forPoll(p models.Poll) (models.Vote, bool) {
	vote := models.Vote{Kind: b.kind()}
	if vote.Kind != p.QuestionType() {
		return vote, false
	}
	switch vote.Kind {
	case models.SingleChoice:
		vote.Choice = *b.Choice
		return vote, vote.Choice < len(p.Choices)
	case models.MultipleChoice:
		vote.Selections = b.Choices
		return vote, len(b.Choices) >= p.Question.Min && len(b.Choices) <= p.Question.Max && distinctChoices(b.Choices, len(p.Choices))
	case models.Rating:
		vote.Choice = *b.Rating - p.Question.Min
		return vote, vote.Choice >= 0 && vote.Choice < len(p.Choices)
	case models.RankedChoice:
		vote.Selections = b.Ranking
		return vote, len(b.Ranking) == len(p.Choices) && distinctChoices(b.Ranking, len(p.Choices))
	case models.WordCloud:
		vote.Term = *b.Text
		vote.Moderation = "pending"
		return vote, true
	}
	return vote, false
}
