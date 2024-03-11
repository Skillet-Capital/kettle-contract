// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Lien, LienStatus, PaymentDeadline } from "./Structs.sol";
import { FixedInterest } from "./models/FixedInterest.sol";

/**
 * @title Kettle Status Viewer
 * @author diamondjim.eth
 * @notice View the status of a lien
 */
contract StatusViewer {

    /**
     * @notice Computes the payment details for a given lien, including balance, principal, and various components of interest and fees.
     *
     * @param lien The Lien structure representing the loan details.
     *
     * @return balance The total amount owed on the loan
     * @return principal The original principal amount of the loan,
     * @return pastInterest The accumulated interest up to the current installment due to default (if any),
     * @return pastFee The accumulated fee up to the current installment due to default (if any),
     * @return currentInterest The interest amount for the current installment,
     * @return currentFee The fee amount for the current installment
     *
     * @dev The function calculates the total amount owed on the loan by summing up the principal, past interest, past fee, current interest, and current fee.
     * It utilizes the `computeInterestAndFees` function from the `FixedInterest` contract to calculate the interest and fee components based on the lien parameters.
     */
    function payments(Lien memory lien) public view returns (
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        principal = lien.state.principal;

        (
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeInterestAndFees(
            lien.startTime,
            lien.state.installment,
            lien.period,
            lien.installments,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            principal
        );

        balance = principal + pastInterest + pastFee + currentInterest + currentFee;
    }

    function repayment(Lien memory lien) public view returns (
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        principal = lien.state.principal;

        (
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeRepayment(
            lien.startTime,
            lien.state.installment,
            lien.period,
            lien.installments,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            principal
        );

        balance = principal + pastInterest + pastFee + currentInterest + currentFee;
    }

    /**
     * @notice Retrieves the current status and payment deadlines for a given lien.
     *
     * @param lien The Lien structure representing the loan details.
     *
     * @return status The current status of the lien (LienStatus),
     * @return balance The total amount owed on the loan,
     * @return delinquent PaymentDeadline structure representing the delinquent payment details,
     * @return current PaymentDeadline structure representing the current payment details
     *
     * @dev The function calculates the payment details for the lien using the `payments` function and determines the current status based on the timestamp and loan parameters.
     * It provides information about the total amount owed (`balance`) and the payment deadlines for both delinquent and current payments.
     */
    function lienStatus(Lien memory lien) 
        public 
        view 
        returns (
            LienStatus status,
            uint256 balance,
            PaymentDeadline memory delinquent, 
            PaymentDeadline memory current
        ) 
    {
        (
            uint256 _balance,
            uint256 principal,
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) = payments(lien);

        balance = _balance;

        uint256 paidThrough = lien.startTime + (lien.state.installment * lien.period);
        uint256 endTime = lien.startTime + (lien.period * lien.installments);
        uint256 lastInstallmentStartTime = lien.startTime + (lien.period * (lien.installments - 1));

        delinquent = PaymentDeadline({
            periodStart: paidThrough,
            deadline: paidThrough + lien.period + lien.gracePeriod,
            principal: 0,
            interest: pastInterest,
            fee: pastFee
        });

        current = PaymentDeadline({
            periodStart: paidThrough,
            deadline: paidThrough + lien.period,
            principal: 0,
            interest: currentInterest,
            fee: currentFee
        });

        // set defaulted status
        status = LienStatus.CURRENT;
        if (block.timestamp > paidThrough + lien.period + lien.gracePeriod) {
            status = LienStatus.DEFAULTED;
            if (block.timestamp > endTime) {
                current.periodStart = 0;
                current.deadline = 0;
            } else {
                current.periodStart = paidThrough + lien.period;
                current.deadline = paidThrough + lien.period * 2;
            }
        }

        else if (block.timestamp > paidThrough + lien.period) {
            status = LienStatus.DELINQUENT;
            if (block.timestamp > endTime) {
                current.periodStart = 0;
                current.deadline = 0;
            } else {
                current.periodStart = paidThrough + lien.period;
                current.deadline = paidThrough + lien.period * 2;
            }
        } 
        
        else {
            delinquent.periodStart = 0;
            delinquent.deadline = 0;
        }

        // if loan is past endtime, delinquent owes principal
        if (block.timestamp > endTime) {
            delinquent.principal = principal;
        } 
        
        // if loan is past last installment start time, current owes principal
        else if (block.timestamp > lastInstallmentStartTime) {
            current.principal = principal;
        }
    }
}
